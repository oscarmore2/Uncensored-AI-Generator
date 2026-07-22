"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "avclubs_age_ok";

export function AgeGate() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(sessionStorage.getItem(STORAGE_KEY) !== "1");
  }, []);

  if (!visible) return null;

  function confirm(ok: boolean) {
    if (!ok) {
      window.location.href = "https://www.google.com";
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
  }

  return (
    <div className="fixed inset-0 bg-black/95 z-[100] flex items-center justify-center">
      <div className="max-w-md w-full mx-4 glass rounded-3xl p-8 text-center modal-pop">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-rose-600 to-red-800 flex items-center justify-center">
          <i className="fas fa-exclamation-triangle text-white text-4xl" />
        </div>
        <h2 className="text-3xl font-bold mb-2">18+ 成人内容</h2>
        <p className="text-gray-400 mb-6">本网站包含AI生成的成人向（NSFW）内容，仅限18岁及以上成年人访问。</p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => confirm(true)}
            className="w-full py-3.5 bg-white text-black font-semibold rounded-2xl hover:bg-gray-200 transition-colors"
          >
            我已满18岁，进入网站
          </button>
          <button
            onClick={() => confirm(false)}
            className="w-full py-3 text-sm text-gray-400 hover:text-white transition-colors"
          >
            我未满18岁，离开
          </button>
        </div>
        <p className="text-[10px] text-gray-500 mt-6">所有内容均为AI虚构生成</p>
      </div>
    </div>
  );
}
