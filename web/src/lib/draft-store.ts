"use client";

/**
 * 生成页草稿的本地缓存。
 *
 * 用 IndexedDB 而不是 localStorage：待生成的参考图 / 视频是 File 对象，
 * localStorage 只能存字符串（转成 base64 既撑爆 5MB 配额又要来回编解码），
 * 而 IndexedDB 的结构化克隆可以直接存 File。
 *
 * 失效规则：草稿带用户标识与服务端启动标识，两者任一对不上就整条丢弃，
 * 于是「换账号 / 登出后重登 / 服务端换代」都会自然清空，平时刷新则原样恢复。
 */

const DB_NAME = "wwkw-drafts";
const DB_VERSION = 1;
const STORE = "drafts";

export type DraftScope = "make" | "plaything";

export type DraftGuard = {
  /** 当前登录用户标识 */
  ownerKey: string;
  /** 服务端启动标识，来自 /api/me 的 server_boot_id */
  bootId: string;
};

type DraftRecord<T> = DraftGuard & {
  scope: DraftScope;
  updatedAt: number;
  payload: T;
};

function idbAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      // 无痕模式等场景下 open 会直接抛错
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "scope" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    // 另一个标签页占着旧版本时不要挂起整个页面
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function runTx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        let req: IDBRequest<T>;
        try {
          req = fn(db.transaction(STORE, mode).objectStore(STORE));
        } catch {
          resolve(null);
          return;
        }
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      })
  );
}

/** 读取草稿；用户或服务端换代了就顺手删掉并返回 null */
export async function loadDraft<T>(scope: DraftScope, guard: DraftGuard): Promise<T | null> {
  const rec = await runTx<DraftRecord<T>>("readonly", (store) => store.get(scope));
  if (!rec) return null;
  if (rec.ownerKey !== guard.ownerKey || rec.bootId !== guard.bootId) {
    await clearDraft(scope);
    return null;
  }
  return rec.payload;
}

/**
 * 同 loadDraft，但把写入时间一并带出来。
 *
 * 服务端草稿接进来之后需要判断谁更新：本地写得成功、服务端那次写失败
 * （断网）的情况下，服务端那份是旧的，直接采纳会把用户离线时的编辑抹掉。
 */
export async function loadDraftRecord<T>(
  scope: DraftScope,
  guard: DraftGuard
): Promise<{ payload: T; updatedAt: number } | null> {
  const rec = await runTx<DraftRecord<T> | undefined>("readonly", (store) => store.get(scope));
  if (!rec || rec.ownerKey !== guard.ownerKey || rec.bootId !== guard.bootId) return null;
  return { payload: rec.payload, updatedAt: rec.updatedAt };
}

/**
 * 写入草稿。配额写满时退化成「只存文本、丢掉媒体」再试一次——
 * 宁可少存参考图，也不要整条草稿写不进去。
 */
export async function saveDraft<T>(
  scope: DraftScope,
  guard: DraftGuard,
  payload: T,
  stripMedia?: (payload: T) => T
): Promise<void> {
  const rec: DraftRecord<T> = { scope, ...guard, updatedAt: Date.now(), payload };
  const ok = await runTx("readwrite", (store) => store.put(rec));
  if (ok !== null || !stripMedia) return;
  const lite: DraftRecord<T> = { ...rec, payload: stripMedia(payload) };
  await runTx("readwrite", (store) => store.put(lite));
}

export async function clearDraft(scope: DraftScope): Promise<void> {
  await runTx("readwrite", (store) => store.delete(scope));
}

/** 登出时调用：把所有草稿一次清干净 */
export async function clearAllDrafts(): Promise<void> {
  await runTx("readwrite", (store) => store.clear());
}
