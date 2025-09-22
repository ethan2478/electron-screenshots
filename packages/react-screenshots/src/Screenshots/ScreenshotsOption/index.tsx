import React, {
  cloneElement,
  memo,
  ReactElement,
  ReactNode,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { ScreenshotsOperationsCtx } from '../ScreenshotsOperations'
import { Point } from '../types'
import './index.less'

export interface ScreenshotsOptionProps {
  open?: boolean;
  content?: ReactNode;
  children: ReactElement;
}

export type Position = Point;

export enum Placement {
  Bottom = 'bottom',
  Top = 'top',
}

export default memo(function ScreenshotsOption ({
  open,
  content,
  children
}: ScreenshotsOptionProps): ReactElement {
  const childrenRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const operationsRect = useContext(ScreenshotsOperationsCtx)
  const [placement, setPlacement] = useState<Placement>(Placement.Bottom)
  const [position, setPosition] = useState<Position | null>(null)
  const [offsetX, setOffsetX] = useState<number>(0)

  const getPopoverEl = () => {
    if (!popoverRef.current) {
      popoverRef.current = document.createElement('div')
    }
    return popoverRef.current
  }

  useEffect(() => {
    const $el = getPopoverEl()
    if (open) {
      document.body.appendChild($el)
    }
    return () => {
      $el.remove()
    }
  }, [open])

  useEffect(() => {
    if (
      !open ||
      !operationsRect ||
      !childrenRef.current ||
      !contentRef.current
    ) {
      return
    }

    // 视口宽高
    const vpWidth = document.documentElement.clientWidth
    const vpHeight = document.documentElement.clientHeight

    // 按钮和操作区域rect
    const childrenRect = childrenRef.current.getBoundingClientRect()
    const contentRect = contentRef.current.getBoundingClientRect()

    // 当前操作按钮的下边框中点坐标
    const midBottomX = childrenRect.x + childrenRect.width / 2
    const midBottomY = childrenRect.y + childrenRect.height

    // 当前操作按钮的上边框中点坐标
    const midTopY = childrenRect.y

    // 默认展示在下方正中间
    let x = midBottomX - contentRect.width / 2
    let y = midBottomY + 15
    let offset = 0
    let vPlacement = Placement.Bottom

    if (x > vpWidth) {
      offset = x - vpWidth - contentRect.width
      x = vpWidth - contentRect.width
    }
    if (x < 0) {
      offset = x
      x = 0
    }
    if (x + contentRect.width > vpWidth) {
      offset = x
      x = 0
    }

    // 当放置在下面超过视口时，调整到上面
    if (y + contentRect.height > vpHeight) {
      y = midTopY - contentRect.height - 15
      vPlacement = Placement.Top
    }

    setOffsetX(offset)
    setPlacement(vPlacement)
    setPosition({ x, y })
  }, [open, operationsRect])

  return (
    <>
      {cloneElement(children, {
        ref: childrenRef
      })}
      {open &&
        content &&
        createPortal(
          <div
            ref={contentRef}
            className='screenshots-option'
            style={{
              visibility: position ? 'visible' : 'hidden',
              transform: `translate(${position?.x ?? 0}px, ${
                position?.y ?? 0
              }px)`
            }}
            data-placement={placement}
          >
            <div className='screenshots-option-container'>{content}</div>
            <div
              className='screenshots-option-arrow'
              style={{ marginLeft: offsetX }}
            />
          </div>,
          getPopoverEl()
        )}
    </>
  )
})
