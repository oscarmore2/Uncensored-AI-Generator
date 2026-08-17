"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 通用的拖动排序容器：把一组元素交给它，用户拖谁到哪，它就回一个新顺序。
 *
 * 不依赖 HTML5 的 draggable —— 那套在触屏上根本不触发，而本站移动端占大头。
 * 这里走 Pointer Events，鼠标/触屏/触控笔同一套代码。
 *
 * 触屏上的取舍：
 * 不给元素设 touch-action: none。设了页面就没法从这块区域滚动，而这些缩略图
 * 在长表单里只占一小条，为它牺牲滚动不值。改成「长按 200ms 才进入拖动」——
 * 手指按住不动的这段时间浏览器不会启动滚动手势，拖动一旦激活，再挂一个
 * 非 passive 的 touchmove 把滚动挡掉。想滚页面就正常划，想排序就先按住。
 *
 * 键盘也能用：聚焦后空格/回车「抓起」，方向键移动，再按一次放下，Esc 取消。
 * 只能拖的话，键盘和读屏用户就完全没法调顺序了。
 */

/** 把 list[from] 挪到 to 位；越界或原地不动时原样返回（复用同一引用，方便调用方判等） */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list;
  if (from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** 长按多久算「要拖动」而不是「要滚页面」 */
const TOUCH_HOLD_MS = 200;
/** 长按期间手指晃动超过这个距离就判定为滚动意图，取消待激活的拖动 */
const HOLD_SLOP_PX = 10;

export function Reorderable<T>({
  items,
  getKey,
  onReorder,
  children: renderItem,
  disabled,
  className = "",
  itemClassName = "",
  describeItem,
}: {
  items: T[];
  getKey: (item: T, index: number) => string;
  onReorder: (next: T[]) => void;
  children: (item: T, ctx: { index: number; dragging: boolean; grabbed: boolean }) => React.ReactNode;
  disabled?: boolean;
  className?: string;
  itemClassName?: string;
  /** 读屏用：这一件叫什么。缺省只报序号 */
  describeItem?: (item: T, index: number) => string;
}) {
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const [grabbed, setGrabbed] = useState<number | null>(null);
  const [announce, setAnnounce] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  /* 拖动过程中的可变状态。放 ref 不放 state：pointermove 每帧都在跑，
   * 位移直接写进 style，只有落点（over）变化才触发重渲染。 */
  const dragRef = useRef<{
    el: HTMLElement;
    /** 指针相对元素左上角的偏移，抓起时记一次 */
    grabX: number;
    grabY: number;
    /** 当前施加的位移，用来从 getBoundingClientRect 反推元素的布局原点 */
    tx: number;
    ty: number;
    from: number;
    over: number;
  } | null>(null);

  /** 长按待激活；手指抬起或晃动超阈值就作废 */
  const holdRef = useRef<{ timer: number; x: number; y: number } | null>(null);

  const cancelHold = useCallback(() => {
    if (holdRef.current) {
      window.clearTimeout(holdRef.current.timer);
      holdRef.current = null;
    }
  }, []);

  const begin = useCallback((el: HTMLElement, index: number, clientX: number, clientY: number) => {
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      el,
      grabX: clientX - rect.left,
      grabY: clientY - rect.top,
      tx: 0,
      ty: 0,
      from: index,
      over: index,
    };
    setDrag({ from: index, over: index });
  }, []);

  const dragging = drag !== null;

  // 拖动期间的全局监听。挂在 document 而不是用 setPointerCapture：
  // 被拖的元素要设 pointer-events: none 才能让 elementFromPoint 看到底下的那件，
  // 而捕获与命中测试的相互作用在各浏览器上不完全一致，document 监听没有这层不确定性。
  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;

      // 元素在 DOM 里的位置会随排序变化，所以每次都从当前 rect 反推布局原点。
      // transform 只有平移，减掉已施加的位移就是原点。
      const rect = d.el.getBoundingClientRect();
      d.tx = e.clientX - d.grabX - (rect.left - d.tx);
      d.ty = e.clientY - d.grabY - (rect.top - d.ty);
      d.el.style.transform = `translate(${d.tx}px, ${d.ty}px)`;

      const under = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-reorder-index]");
      if (!under || !containerRef.current?.contains(under)) return;
      const over = Number(under.dataset.reorderIndex);
      if (Number.isInteger(over) && over !== d.over) {
        d.over = over;
        setDrag({ from: d.from, over });
      }
    };

    const finish = () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (d) {
        d.el.style.transform = "";
        if (d.over !== d.from) {
          onReorderRef.current(moveItem(itemsRef.current, d.from, d.over));
          setAnnounce(`已移动到第 ${d.over + 1} 位，共 ${itemsRef.current.length} 位`);
        }
      }
      setDrag(null);
    };

    // 拖动一旦激活就不让页面跟着滚。必须 passive: false，否则 preventDefault 无效。
    const stopScroll = (e: TouchEvent) => e.preventDefault();

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
    document.addEventListener("touchmove", stopScroll, { passive: false });
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      document.removeEventListener("touchmove", stopScroll);
    };
  }, [dragging]);

  // 拖动途中外面把列表改了（比如又传完一个），下标就对不上了，直接放弃这次拖动
  useEffect(() => {
    const d = dragRef.current;
    if (d && items.length <= Math.max(d.from, d.over)) {
      d.el.style.transform = "";
      dragRef.current = null;
      setDrag(null);
    }
    if (grabbed !== null && grabbed >= items.length) setGrabbed(null);
  }, [items.length, grabbed]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, index: number) => {
      if (disabled || e.button !== 0) return;
      // 让 chip 上的删除按钮之类照常工作
      if ((e.target as HTMLElement).closest("button,a,input")) return;

      const el = e.currentTarget;
      if (e.pointerType === "mouse" || e.pointerType === "pen") {
        // 挡掉浏览器对图片/文字的原生拖拽（chip 里就是 <img>，不挡会拖出一个半透明拖影）。
        // 但 preventDefault 会连默认的取焦一起挡掉，于是点一下 chip 焦点还留在 body，
        // 「先点中再用键盘挪」就断了——所以这里得自己把焦点放上去。
        e.preventDefault();
        el.focus();
        begin(el, index, e.clientX, e.clientY);
        return;
      }
      // 触屏：先等一会儿，确认用户不是想滚页面
      const { clientX, clientY } = e;
      cancelHold();
      holdRef.current = {
        x: clientX,
        y: clientY,
        timer: window.setTimeout(() => {
          holdRef.current = null;
          begin(el, index, clientX, clientY);
        }, TOUCH_HOLD_MS),
      };
    },
    [begin, cancelHold, disabled]
  );

  const onPointerMoveBeforeDrag = useCallback(
    (e: React.PointerEvent) => {
      const h = holdRef.current;
      if (!h) return;
      if (Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP_PX) cancelHold();
    },
    [cancelHold]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (disabled) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        const next = grabbed === index ? null : index;
        setGrabbed(next);
        setAnnounce(
          next === null ? "已放下" : `已抓起第 ${index + 1} 位，方向键移动，再按空格放下`
        );
        return;
      }
      if (e.key === "Escape" && grabbed !== null) {
        e.preventDefault();
        setGrabbed(null);
        setAnnounce("已取消");
        return;
      }
      if (grabbed === null) return;
      const delta =
        e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : e.key === "ArrowRight" || e.key === "ArrowDown"
            ? 1
            : 0;
      if (!delta) return;
      e.preventDefault();
      const to = grabbed + delta;
      if (to < 0 || to >= items.length) return;
      onReorder(moveItem(items, grabbed, to));
      setGrabbed(to);
      setAnnounce(`第 ${to + 1} 位，共 ${items.length} 位`);
      // 元素跟着顺序换了位置，焦点得追过去，否则下一次方向键落在别的元素上
      requestAnimationFrame(() => {
        containerRef.current
          ?.querySelector<HTMLElement>(`[data-reorder-index="${to}"]`)
          ?.focus();
      });
    },
    [disabled, grabbed, items, onReorder]
  );

  // 拖动中按落点预览顺序；始终从原始 items 推导，不会自我叠加
  const view = drag ? moveItem(items, drag.from, drag.over) : items;

  return (
    <>
      <div ref={containerRef} className={className} role="list">
        {view.map((item, i) => {
          const isDragging = drag !== null && drag.over === i;
          const isGrabbed = grabbed === i;
          return (
            <div
              key={getKey(item, i)}
              data-reorder-index={i}
              role="listitem"
              tabIndex={disabled ? -1 : 0}
              aria-label={`${describeItem?.(item, i) ?? "项目"}，第 ${i + 1} 位，共 ${items.length} 位`}
              aria-roledescription="可排序项"
              onPointerDown={(e) => onPointerDown(e, i)}
              onPointerMove={onPointerMoveBeforeDrag}
              onPointerUp={cancelHold}
              onPointerCancel={cancelHold}
              onKeyDown={(e) => onKeyDown(e, i)}
              onBlur={() => isGrabbed && setGrabbed(null)}
              className={[
                itemClassName,
                disabled ? "" : "cursor-grab touch-manipulation select-none",
                // 被拖的那件要让开命中测试，否则 elementFromPoint 永远只看得见它自己
                isDragging ? "pointer-events-none z-20 cursor-grabbing shadow-2xl" : "",
                isGrabbed ? "z-20 ring-2 ring-orange-500 ring-offset-2" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {renderItem(item, { index: i, dragging: isDragging, grabbed: isGrabbed })}
            </div>
          );
        })}
      </div>
      <span aria-live="polite" className="sr-only">
        {announce}
      </span>
    </>
  );
}
