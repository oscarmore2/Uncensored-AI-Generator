# 自建加密货币收款 · 规划文档

> 状态：待决策。本文只描述方案与取舍，未开始实现。
> 目标读者：本项目的开发与运维。

## 一、为什么写这份文档

现在的加密收款走 NOWPayments。自建的动机是去掉平台抽成与账户风险，
代价是把托管风险和一整套链上工程接到自己手里。

**先说结论**：技术上完全可行，且项目里最难写对的那部分已经写对了；
真正的成本不在写代码，而在密钥保管、归集运维和合规判断。

---

## 二、现状盘点：已经有什么

### 可以原样复用（约占整体工作量的三分之一）

`web/src/lib/nowpayments.ts` 里的 `creditNowPayment` 是整套支付系统最容易
写错的地方，而它是对的：

```ts
const claimed = await tx.nowPayment.updateMany({
  where: { orderId: payment.orderId, credited: false },
  data: { credited: true },
});
if (claimed.count === 0) return false;   // 已被别人抢到，直接退出
// 之后才 increment 余额、写 Transaction
```

用「条件更新的影响行数」当锁，在一个事务里完成占位 + 加余额 + 记流水。
并发重放、Webhook 重投、管理员手工补单同时发生都不会重复加点。
**自建方案直接复用这个结算内核，不要另起炉灶。**

同样可复用的还有：

| 现有资产 | 用途 |
| --- | --- |
| `lib/secret-crypto.ts` | 加密存储 xpub |
| `Transaction` 表 + 余额自增 | 入账落账，完全不变 |
| `lib/pricing.ts` 套餐 | 定价来源不变 |
| `lib/providers/` 的适配器模式 | 照抄成「链适配器」 |
| `railway.backfill.toml` 的独立服务模式 | 照抄成监听服务 |
| 管理端页面骨架 | 加一个链上流水页 |

### 必须新建的（NOWPayments 实际替我们做的五件事）

1. 给每笔订单发收款地址
2. USD → 币种报价与锁定
3. 盯链、判确认数、处理重组
4. 多付 / 少付 / 迟付的入账策略
5. 资金托管与归集

---

## 三、范围界定

### 第一版只做

- **链**：Tron
- **币**：TRC20-USDT
- **动作**：只收，不归集（资金留在派生地址，人工批量归集）

### 为什么是 TRC20-USDT

- 面向大陆用户的事实标准，手续费低到可以忽略
- **稳定币直接绕掉「报价锁定」一整块复杂度**。上 BTC/ETH 的话，价格在
  支付窗口内跑掉，少付判定、退款、汇率争议会让工作量翻倍，而这些复杂度
  与「验证自建方案可行」这个目标无关

### 明确不做

- ❌ **不做「同一地址 + 唯一金额」方案**。看起来省事，但两个用户买同一个
  套餐就撞了，而这恰恰是最常见的情况。金额尾数扰动能缓解，缓解不了并发。
- ❌ 第一版不做退款。链上转账不可逆，退款是人工流程。
- ❌ 不做自建全节点（见 §7 的信任边界说明）。

---

## 四、核心设计

### 4.1 一笔订单一个地址，地址从 xpub 派生

这是唯一能让「**Web 服务器上没有任何私钥**」成立的做法。

Tron 与 EVM 都用 secp256k1，在 BIP32 **非硬化**路径下，光有扩展公钥
（xpub）就能算出所有子地址，私钥完全不需要出现在线上：

- Tron：`m/44'/195'/0'/0/i`
- EVM：`m/44'/60'/0'/0/i`

线上只存 xpub 与下一个可用 index，助记词离线保管。

### 4.2 组件划分

```
用户 ──下单──> Next.js /api/payments/crypto/create
                  │  从 xpub 派生第 i 个地址，落 CryptoOrder
                  ▼
              收款地址（展示二维码 + 倒计时）
                  │
                  │  用户转账
                  ▼
              Tron 链
                  ▲
                  │  扫块，匹配 Transfer 事件的 to
          ┌───────┴────────┐
          │  监听服务      │  独立 Railway 服务，同一镜像换启动命令
          │  crypto-watch  │  写 CryptoDeposit，够确认数后调结算内核
          └────────────────┘
                  │
                  ▼
        复用 creditNowPayment 的原子占位 → 加余额 + 写 Transaction
```

**监听服务用常驻进程，不用 cron。** 现有的 cleanup/backfill 是 cron
（30 分钟一次）没问题，但支付不同：用户正盯着「等待到账」的页面，
延迟要压到十几秒。常驻循环比每分钟拉起一个容器更省也更快。

### 4.3 链适配器

照 `src/lib/providers/` 的样子做 `src/lib/chains/`，目标同样是
「加一条链 = 加一个适配器」：

```ts
export type ChainAdapter = {
  id: ChainId;
  /** 从 xpub 派生第 index 个收款地址，不碰私钥 */
  deriveAddress(xpub: string, index: number): string;
  /** 当前链头高度 */
  tipBlock(): Promise<bigint>;
  /** 扫区间内命中这批地址的代币转账 */
  scanTransfers(from: bigint, to: bigint, watched: Set<string>): Promise<RawTransfer[]>;
  /** 入账前的最后一道：这笔 tx 还在主链上吗（防重组） */
  isTxAlive(txHash: string): Promise<boolean>;
  /** 该链认为多少确认算最终 */
  requiredConfirmations: number;
};
```

---

## 五、数据模型

```prisma
/// 收款钱包。只存扩展公钥，助记词永远不进数据库。
model CryptoWallet {
  id        Int      @id @default(autoincrement())
  chain     String                          // "tron" | "bsc" | ...
  label     String
  xpubEnc   String                          // secret-crypto 加密
  derivPath String                          // "m/44'/195'/0'/0"
  nextIndex Int      @default(0)            // 下一个可用派生序号
  isActive  Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([chain, isActive])
}

model CryptoOrder {
  id             Int      @id @default(autoincrement())
  userId         Int
  orderId        String   @unique
  credits        Int
  amountUsdCents Int

  chain          String
  token          String                     // "USDT"
  tokenDecimals  Int                        // Tron 上是 6，BSC 上是 18
  expectedRaw    String                     // 最小单位，字符串存
  address        String
  derivIndex     Int

  receivedRaw    String   @default("0")     // 累计已收
  status         String   @default("pending") // pending|underpaid|paid|credited|expired
  credited       Boolean  @default(false)   // 结算内核的原子占位位
  expiresAt      DateTime
  createdAt      DateTime @default(now())

  user User @relation(fields: [userId], references: [id])

  @@unique([chain, address])                // 地址永不复用
  @@index([status, expiresAt])
  @@index([userId, createdAt])
}

/// 链上到账流水。幂等的根在这张表的唯一约束上。
model CryptoDeposit {
  id            Int      @id @default(autoincrement())
  chain         String
  txHash        String
  logIndex      Int
  address       String
  token         String
  rawAmount     String
  blockNumber   BigInt
  status        String   @default("seen")   // seen|confirmed|orphaned|applied
  orderId       String?
  seenAt        DateTime @default(now())

  @@unique([chain, txHash, logIndex])       // ← 整套系统的幂等基石
  @@index([address, status])
  @@index([status, blockNumber])
}

/// 扫块游标，服务重启后从这里续上
model CryptoScanCursor {
  chain     String   @id
  lastBlock BigInt
  updatedAt DateTime @updatedAt
}
```

---

## 六、五个必须做对的点

这五条不是「最好注意一下」，是「做错了会丢钱或重复发货」。

### 1. 幂等键必须落在链上唯一标识

不是 `orderId`，是 `(chain, txHash, logIndex)` 的唯一约束。同一笔交易可能
被重复处理，同一个地址也可能收到多笔转账。**先靠唯一约束挡住重复插入，
再谈业务逻辑。**

### 2. 金额一律用最小单位的字符串 / BigInt

绝不用 JS `number`。USDT 在 Tron 是 6 位小数、在 BSC 是 18 位，
`0.1 + 0.2 !== 0.3` 在钱上就是事故。`expectedRaw` / `receivedRaw` /
`rawAmount` 全部按最小单位存字符串。

### 3. 重组回滚

确认数够了不等于安全。**入账前要再查一次这笔 tx 是否还在主链上**
（`isTxAlive`）。Tron 约 19 块，BSC 约 15 块。已 `applied` 的记录若发现
被重组掉，要走人工冲正流程，不能自动扣余额。

### 4. 迟付、少付、多付是日常，不是异常

真实流量里天天发生：过期后才转账、转少了几毛、分两笔转。

**记账方式要从「订单匹配」改成「地址流水累计」**：地址收到多少就记多少，
`receivedRaw >= expectedRaw` 才发货，多出来的挂进用户余额。

> 现有 `settleNowPayment` 要求金额**精确相等**（`receivedCents === amountUsdCents`）。
> 那是因为 NOWPayments 已经替我们吸收了这些情况。自建后这条规则会疯狂误伤，
> 必须改。

订单过期后**地址不要回收**，永久绑定到该订单——用户迟付会打到旧地址上。

### 5. xpub 泄露 + 任一子私钥泄露 = 主私钥全丢

这是 BIP32 非硬化派生的数学性质，很多人不知道：两样单独泄露都只是局部
损失，凑齐就能反推出主私钥，整个钱包被清空。

**推论：xpub 虽然「只是公钥」，也必须按敏感信息管；签名器绝不能与 xpub
存放在同一处。**

---

## 七、密钥与信任边界

| 东西 | 放在哪 | 泄露后果 |
| --- | --- | --- |
| 助记词 / 主私钥 | 离线，纸质或硬件钱包 | 全部资金 |
| xpub | 线上 DB，`secret-crypto` 加密 | 隐私（所有地址可推导）；配合子私钥则等于全部资金 |
| 子私钥 | **归集时才在隔离签名器里现算**，不落盘 | 单个地址 + 见上 |
| 冷钱包收款地址 | 线上只读 | 无 |

**关于 RPC 节点的诚实说明**：完全不依赖第三方就得自建全节点（Tron 全节点
2TB 起步）。现实做法是接两家以上公共 RPC 做交叉验证——信任面比支付平台
小得多（可验证、可替换、不托管资金），但不是零。这一点要认。

---

## 八、分阶段落地

每一阶段都有明确的「做完了」标准，不达标不进下一阶段。

### P0 · 真钱跑通（最小可用）
- `CryptoWallet` / `CryptoOrder` / `CryptoDeposit` / `CryptoScanCursor` 四张表
- Tron 链适配器：派生地址 + 扫 TRC20 `Transfer`
- 常驻监听服务（Railway 独立服务，同一镜像）
- 下单页：地址 + 二维码 + 倒计时 + 轮询状态
- 结算复用 `creditNowPayment` 的原子占位
- **完成标准**：自己用小额真实转账，走通「下单 → 到账 → 加点」，
  并人为重投监听验证不会重复加点

### P1 · 异常路径
- 少付 / 多付 / 迟付 / 分次付的入账策略（§6.4）
- 重组检测与人工冲正入口
- 管理端链上流水页（可查、可手工补单，对齐现有 `/admin/crypto`）
- **完成标准**：把上述四种异常各造一遍，行为符合预期且可解释

### P2 · 归集
- gas station：先给派生地址打少量 TRX（能量/带宽），再扫回冷钱包
- 隔离签名器，**不在 Next.js 进程里**
- **完成标准**：一次批量归集，无人工逐笔操作

### P3 · 多链与灰度
- 抽出 `CryptoGateway` 网关层，`nowpayments` 与 `selfhosted` 平级
  （照 `lib/providers/` 的注册表写法）
- `CryptoPayment` 加 `provider` 列
- 加第二条链（BSC 或 Polygon）
- **完成标准**：能按比例把流量切给自建，出问题一键切回

---

## 九、需要你拍板的开放问题

1. **接受哪些链和币**？第一版只上 TRC20-USDT 是否可接受
2. **冷钱包由谁保管**？助记词的物理保管方案与备份策略
3. **少付怎么处理**？按比例入账，还是挂起等人工
4. **是否保留 NOWPayments 兜底**？建议保留到 P3 灰度稳定
5. **合规**：自建收款在部分司法辖区涉及 MSB / VASP 牌照。这是业务判断，
   不是技术问题，但会直接决定要不要做

---

## 十、风险清单

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 私钥丢失 / 保管不当 | 资金全损，不可逆 | 硬件钱包 + 异地备份 + 定期恢复演练 |
| 重复入账 | 白送点数 | `(chain,txHash,logIndex)` 唯一约束 + 原子占位 |
| 精度错误 | 金额算错 | 全链路最小单位 BigInt/字符串 |
| 链重组 | 入账后钱没了 | 足够确认数 + 入账前复查 |
| RPC 提供方作恶或故障 | 漏单 / 假到账 | 双 RPC 交叉验证 + 到账告警 |
| 归集打错地址 | 资金全损，不可逆 | 白名单地址 + 小额试转 + 二次确认 |
| 用户迟付到已过期订单 | 客诉 | 地址永不回收，迟付自动挂余额 |

---

## 附：与现有代码的对应关系

| 现有 | 自建后 |
| --- | --- |
| `lib/nowpayments.ts` `createNowPaymentsInvoice` | `lib/chains/*` 派生地址 |
| NOWPayments IPN Webhook | 常驻监听服务扫块 |
| `settleNowPayment` 的精确金额校验 | 地址流水累计（§6.4） |
| `creditNowPayment` | **原样复用** |
| `NowPayment` 表 | `CryptoOrder` + `CryptoDeposit` |
| `/admin/nowpayments` | 增加 `/admin/crypto-wallets` |
