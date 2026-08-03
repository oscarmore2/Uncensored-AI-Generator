"use client";

import { useEffect } from "react";

/**
 * 弹窗打开期间锁住页面滚动。
 *
 * 不锁的话，鼠标停在弹窗里滚动、滚的却是背后的页面——弹窗自己那点内容
 * 反而滚不动，因为滚动事件被下面的文档抢走了。
 *
 * 用计数而不是布尔：弹窗可以叠弹窗（作品详情上再开「媒体已被清理」提示），
 * 内层关闭时不能把外层的锁一起解掉。
 */
let openCount = 0;
let savedOverflow = "";
let savedPaddingRight = "";

export function useBodyScrollLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    if (openCount === 0) {
      const body = document.body;
      savedOverflow = body.style.overflow;
      savedPaddingRight = body.style.paddingRight;
      // 隐藏滚动条会让页面变宽，补上等宽内边距，避免背景内容左右跳一下
      const gap = window.innerWidth - document.documentElement.clientWidth;
      if (gap > 0) body.style.paddingRight = `${gap}px`;
      body.style.overflow = "hidden";
    }
    openCount += 1;

    return () => {
      openCount -= 1;
      if (openCount === 0) {
        document.body.style.overflow = savedOverflow;
        document.body.style.paddingRight = savedPaddingRight;
      }
    };
  }, [enabled]);
}
