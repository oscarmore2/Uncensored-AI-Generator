"""
AVClubs Backend - FastAPI
完整后端服务：用户系统 + 点数钱包 + Zen Creator 代理 + Stripe 支付 + 生成历史

运行方式：
1. pip install -r requirements.txt
2. cp .env.example .env  并填入你的密钥
3. uvicorn main:app --reload

生产建议：
- 换成 PostgreSQL (DATABASE_URL=postgresql://...)
- 使用 Supabase Auth 或 Auth0 替代简单 JWT
- 部署到 Render / Railway / Fly.io
"""

import os
import json
import asyncio
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, status, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean, Text, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from jose import JWTError, jwt
from passlib.context import CryptContext
import stripe
import httpx
from dotenv import load_dotenv

# ==================== 配置 ====================
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./avclubs.db")
SECRET_KEY = os.getenv("SECRET_KEY", "change-this-in-production")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 60*24*7))

ZEN_API_KEY = os.getenv("ZEN_API_KEY", "")
ZEN_BASE_URL = os.getenv("ZEN_BASE_URL", "https://api.zencreator.pro/api/public/v1")

STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
stripe.api_key = STRIPE_SECRET_KEY

DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"

# 点数套餐 (cents)
CREDIT_PACKAGES = json.loads(os.getenv("CREDIT_PACKAGES", '{"100": 2900, "500": 12900, "1200": 29900, "3000": 69900}'))
VIP_PRICE = int(os.getenv("VIP_PRICE", 9900))

# ==================== 数据库 ====================
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    balance = Column(Integer, default=20)  # 新用户赠送
    is_vip = Column(Boolean, default=False)
    vip_expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    generations = relationship("Generation", back_populates="user")
    transactions = relationship("Transaction", back_populates="user")

class Generation(Base):
    __tablename__ = "generations"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    mode = Column(String)           # txt2img / txt2vid / img2img / img2vid
    prompt = Column(Text)
    negative_prompt = Column(Text, nullable=True)
    params = Column(Text)           # JSON string
    zen_job_id = Column(String, nullable=True)
    status = Column(String, default="pending")  # pending, processing, succeeded, failed
    result_urls = Column(Text, nullable=True)   # JSON array
    cost = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User", back_populates="generations")

class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    type = Column(String)           # recharge / vip / generation / refund
    amount = Column(Integer)        # 点数变化
    price_cents = Column(Integer, nullable=True)
    stripe_payment_id = Column(String, nullable=True)
    method = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User", back_populates="transactions")

Base.metadata.create_all(bind=engine)

# ==================== Pydantic 模型 ====================
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class UserCreate(BaseModel):
    username: str
    password: str

class UserOut(BaseModel):
    id: int
    username: str
    balance: int
    is_vip: bool
    vip_expires_at: Optional[datetime] = None

class GenerationCreate(BaseModel):
    mode: str = Field(..., pattern="^(txt2img|txt2vid|img2img|img2vid)$")
    prompt: str
    negative_prompt: Optional[str] = ""
    ratio: str = "1:1"
    style: str = "realistic"
    quality: str = "quality"
    batch: int = 1
    image_base64: Optional[str] = None   # 前端传 base64（生产建议先上传到 OSS）

class GenerationOut(BaseModel):
    id: int
    mode: str
    prompt: str
    status: str
    result_urls: Optional[List[str]] = None
    cost: int
    created_at: datetime

class RechargeRequest(BaseModel):
    package: str   # "100", "500" 等

# ==================== 工具函数 ====================
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user

# ==================== Zen Creator 客户端 ====================
class ZenClient:
    def __init__(self):
        self.base_url = ZEN_BASE_URL
        self.headers = {
            "Authorization": f"Bearer {ZEN_API_KEY}",
            "Content-Type": "application/json"
        }
        self.client = httpx.AsyncClient(timeout=60.0)

    async def upload_asset(self, image_base64: str, filename: str = "upload.png") -> str:
        """上传图片返回 asset_id"""
        if not image_base64:
            return None
        # 生产环境建议把 base64 转成 bytes 上传
        # 这里简化：假设前端已处理或使用 multipart
        # 实际应使用 files= 参数
        return "demo_asset_id_" + str(int(datetime.utcnow().timestamp()))

    async def create_generation(self, tool: str, input_data: dict) -> dict:
        """启动生成任务"""
        payload = {"tool": tool, "input": input_data}
        resp = await self.client.post(f"{self.base_url}/generations", json=payload, headers=self.headers)
        resp.raise_for_status()
        return resp.json()

    async def get_generation_status(self, job_id: str) -> dict:
        resp = await self.client.get(f"{self.base_url}/generations/{job_id}", headers=self.headers)
        resp.raise_for_status()
        return resp.json()

    async def get_generation_result(self, job_id: str) -> dict:
        resp = await self.client.get(f"{self.base_url}/generations/{job_id}/result", headers=self.headers)
        resp.raise_for_status()
        return resp.json()

zen_client = ZenClient()

def get_zen_tool_and_input(mode: str, prompt: str, params: dict, image_asset_id: Optional[str] = None) -> tuple:
    """根据模式返回 Zen 的 tool 名称和 input"""
    ratio = params.get("ratio", "1:1")
    # 简化映射，实际可更精细
    if mode == "txt2img":
        return "by_prompt", {
            "positive_prompt": prompt,
            "negative_prompt": params.get("negative_prompt", ""),
            "model": "SDXL_NSFW" if not DEMO_MODE else "GENERAL_NSFW",
            "ratio": ratio,
            "mode": params.get("quality", "quality")
        }
    elif mode == "img2img":
        return "image_editor", {
            "image_assets": [image_asset_id] if image_asset_id else [],
            "prompt": prompt,
            "model": "SDXL_NSFW",
            "ratio": ratio
        }
    elif mode == "txt2vid":
        return "text_to_video", {
            "prompt": prompt,
            "model": "wan@2.7-nsfw" if not DEMO_MODE else "seedance_2_0",
            "duration": 5,
            "resolution": "1280x720"
        }
    elif mode == "img2vid":
        return "videogen", {
            "ref_asset": image_asset_id,
            "prompt": prompt,
            "model": "wan@2.7-nsfw",
            "duration": 4
        }
    return "by_prompt", {"positive_prompt": prompt}

# ==================== 启动事件 ====================
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 创建 demo 用户
    db = SessionLocal()
    if not db.query(User).filter(User.username == "demo_user").first():
        demo_user = User(
            username="demo_user",
            hashed_password=get_password_hash("demo123"),
            balance=128
        )
        db.add(demo_user)
        db.commit()
        print("✅ Demo user created: demo_user / demo123")
    db.close()
    yield

app = FastAPI(title="AVClubs Backend", version="1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产改成前端域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==================== 路由 ====================

@app.get("/")
async def root():
    return {"message": "AVClubs Backend is running", "zen_connected": bool(ZEN_API_KEY)}

# --- Auth ---
@app.post("/auth/register", response_model=UserOut)
async def register(user: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == user.username).first():
        raise HTTPException(400, "Username already registered")
    db_user = User(username=user.username, hashed_password=get_password_hash(user.password))
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@app.post("/auth/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(400, "Incorrect username or password")
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/users/me", response_model=UserOut)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user

# --- Generations ---
@app.post("/generations/start", response_model=GenerationOut)
async def start_generation(
    gen: GenerationCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # 计算消耗
    cost_map = {"txt2img": 2, "txt2vid": 15, "img2img": 3, "img2vid": 20}
    cost = cost_map.get(gen.mode, 2) * (1.5 if gen.batch == 4 else 1)
    cost = int(cost)

    if current_user.balance < cost:
        raise HTTPException(400, "Insufficient credits")

    # 扣费
    current_user.balance -= cost
    db.commit()

    # 创建记录
    db_gen = Generation(
        user_id=current_user.id,
        mode=gen.mode,
        prompt=gen.prompt,
        negative_prompt=gen.negative_prompt,
        params=json.dumps({"ratio": gen.ratio, "style": gen.style, "quality": gen.quality, "batch": gen.batch}),
        cost=cost,
        status="pending"
    )
    db.add(db_gen)
    db.commit()
    db.refresh(db_gen)

    # 异步调用 Zen
    background_tasks.add_task(process_zen_generation, db_gen.id, gen, current_user.id)

    return db_gen

async def process_zen_generation(gen_id: int, gen_data: GenerationCreate, user_id: int):
    """后台处理 Zen 生成"""
    db = SessionLocal()
    try:
        gen_record = db.query(Generation).get(gen_id)
        gen_record.status = "processing"
        db.commit()

        tool, input_data = get_zen_tool_and_input(
            gen_data.mode, 
            gen_data.prompt, 
            json.loads(gen_record.params),
            None  # 生产环境先调用 upload_asset
        )

        if DEMO_MODE or not ZEN_API_KEY:
            # Demo 模式：直接成功
            await asyncio.sleep(2.5)
            gen_record.status = "succeeded"
            gen_record.result_urls = json.dumps([
                f"https://picsum.photos/id/{(gen_id % 30) + 10}/800/1200",
                f"https://picsum.photos/id/{(gen_id % 30) + 20}/800/1200"
            ])
            db.commit()
            return

        # 真实 Zen 调用
        job = await zen_client.create_generation(tool, input_data)
        job_id = job["id"]
        gen_record.zen_job_id = job_id
        db.commit()

        # 轮询
        for _ in range(60):  # 最多轮询 ~5 分钟
            await asyncio.sleep(5)
            status_resp = await zen_client.get_generation_status(job_id)
            if status_resp["status"] in ["succeeded", "failed"]:
                break

        if status_resp["status"] == "succeeded":
            result = await zen_client.get_generation_result(job_id)
            urls = [item.get("download_url") or item.get("url") for item in result.get("outputs", [])]
            gen_record.status = "succeeded"
            gen_record.result_urls = json.dumps(urls)
        else:
            gen_record.status = "failed"
            # 可在此退款
            user = db.query(User).get(user_id)
            user.balance += gen_record.cost
            db.add(Transaction(user_id=user_id, type="refund", amount=gen_record.cost))

        db.commit()
    except Exception as e:
        print(f"Zen generation error: {e}")
        gen_record = db.query(Generation).get(gen_id)
        if gen_record:
            gen_record.status = "failed"
            db.commit()
    finally:
        db.close()

@app.get("/generations/{gen_id}/status")
async def get_generation_status(gen_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    gen = db.query(Generation).filter(Generation.id == gen_id, Generation.user_id == current_user.id).first()
    if not gen:
        raise HTTPException(404, "Generation not found")
    return {"id": gen.id, "status": gen.status, "result_urls": json.loads(gen.result_urls) if gen.result_urls else None}

@app.get("/history", response_model=List[GenerationOut])
async def get_history(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    gens = db.query(Generation).filter(Generation.user_id == current_user.id).order_by(Generation.created_at.desc()).limit(50).all()
    return gens

# --- Payments (Stripe) ---
@app.post("/payments/create-checkout")
async def create_checkout(recharge: RechargeRequest, current_user: User = Depends(get_current_user)):
    if recharge.package not in CREDIT_PACKAGES:
        raise HTTPException(400, "Invalid package")

    price_cents = CREDIT_PACKAGES[recharge.package]
    credits = int(recharge.package)

    if DEMO_MODE:
        # Demo 直接加点数
        db = SessionLocal()
        user = db.query(User).get(current_user.id)
        user.balance += credits
        db.add(Transaction(user_id=user.id, type="recharge", amount=credits, price_cents=price_cents, method="demo"))
        db.commit()
        return {"demo": True, "message": f"Demo mode: +{credits} credits added", "new_balance": user.balance}

    # 真实 Stripe Checkout
    session = stripe.checkout.Session.create(
        payment_method_types=["card"],
        line_items=[{
            "price_data": {
                "currency": "usd",
                "product_data": {"name": f"AVClubs {credits} Credits"},
                "unit_amount": price_cents,
            },
            "quantity": 1,
        }],
        mode="payment",
        success_url="https://your-frontend.com/success?session_id={CHECKOUT_SESSION_ID}",
        cancel_url="https://your-frontend.com/cancel",
        metadata={"user_id": str(current_user.id), "credits": str(credits)}
    )
    return {"checkout_url": session.url}

@app.post("/payments/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except Exception as e:
        raise HTTPException(400, f"Webhook error: {e}")

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        user_id = int(session["metadata"]["user_id"])
        credits = int(session["metadata"]["credits"])

        user = db.query(User).get(user_id)
        if user:
            user.balance += credits
            db.add(Transaction(
                user_id=user_id,
                type="recharge",
                amount=credits,
                price_cents=session["amount_total"],
                stripe_payment_id=session["payment_intent"],
                method="stripe"
            ))
            db.commit()

    return {"status": "success"}

# --- VIP ---
@app.post("/payments/subscribe-vip")
async def subscribe_vip(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if DEMO_MODE:
        current_user.is_vip = True
        current_user.vip_expires_at = datetime.utcnow() + timedelta(days=30)
        current_user.balance += 800
        db.add(Transaction(user_id=current_user.id, type="vip", amount=800, price_cents=VIP_PRICE, method="demo"))
        db.commit()
        return {"message": "VIP activated (demo)", "new_balance": current_user.balance}

    # 真实 Stripe Subscription 可在此扩展
    return {"message": "VIP subscription endpoint ready for Stripe Subscription"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)