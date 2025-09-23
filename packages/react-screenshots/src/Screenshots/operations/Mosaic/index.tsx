import React, {
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'
import ScreenshotsButton from '../../ScreenshotsButton'
import ScreenshotsSize from '../../ScreenshotsSize'
import useCanvasMousedown from '../../hooks/useCanvasMousedown'
import useCanvasMousemove from '../../hooks/useCanvasMousemove'
import useCanvasMouseup from '../../hooks/useCanvasMouseup'
import { HistoryItemSource, HistoryItemType } from '../../types'
import useOperation from '../../hooks/useOperation'
import useCursor from '../../hooks/useCursor'
import useStore from '../../hooks/useStore'
import useBounds from '../../hooks/useBounds'
import useHistory from '../../hooks/useHistory'
import useCanvasContextRef from '../../hooks/useCanvasContextRef'
import useLang from '../../hooks/useLang'

export interface MosaicTile {
  x: number;
  y: number;
  color: number[];
}

export interface MosaicData {
  size: number;
  tiles: MosaicTile[];
}

function getColor (x: number, y: number, imageData: ImageData): number[] {
  if (!imageData) {
    return [0, 0, 0, 0]
  }
  const { data, width } = imageData

  const index = y * width * 4 + x * 4

  return Array.from(data.slice(index, index + 4))
}

// 计算以(x, y)为中心、边长为size的方块的平均颜色，坐标和尺寸基于截图区域Canvas
function getAverageBlockColor (
  x: number,
  y: number,
  size: number,
  imageData: ImageData
): number[] {
  if (!imageData || size <= 1) {
    return getColor(Math.round(x), Math.round(y), imageData)
  }

  const { data, width, height } = imageData
  const half = Math.floor(size / 2)

  const startX = Math.max(0, Math.floor(x) - half)
  const startY = Math.max(0, Math.floor(y) - half)
  const endX = Math.min(width - 1, Math.floor(x) + half)
  const endY = Math.min(height - 1, Math.floor(y) + half)

  let r = 0
  let g = 0
  let b = 0
  let a = 0
  let count = 0

  for (let j = startY; j <= endY; j++) {
    const rowIndex = j * width * 4
    for (let i = startX; i <= endX; i++) {
      const idx = rowIndex + i * 4
      r += data[idx]
      g += data[idx + 1]
      b += data[idx + 2]
      a += data[idx + 3]
      count++
    }
  }

  if (count === 0) return [0, 0, 0, 0]

  return [r / count, g / count, b / count, a / count]
}

function draw (
  ctx: CanvasRenderingContext2D,
  action: HistoryItemSource<MosaicData, null>
) {
  const { tiles, size } = action.data
  tiles.forEach((tile) => {
    const r = Math.round(tile.color[0])
    const g = Math.round(tile.color[1])
    const b = Math.round(tile.color[2])
    const a = tile.color[3] / 255

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`
    ctx.fillRect(tile.x - size / 2, tile.y - size / 2, size, size)
  })
}

export default function Mosaic (): ReactElement {
  const lang = useLang()
  const { image, width, height } = useStore()
  const [operation, operationDispatcher] = useOperation()
  const canvasContextRef = useCanvasContextRef()
  const [history, historyDispatcher] = useHistory()
  const [bounds] = useBounds()
  const [, cursorDispatcher] = useCursor()
  const [size, setSize] = useState(3)
  const imageDataRef = useRef<ImageData | null>(null)
  const mosaicRef = useRef<HistoryItemSource<MosaicData, null> | null>(null)
  // 记录当前一次笔划已添加的网格块，避免重复
  const visitedKeyRef = useRef<Set<string>>(new Set())
  // 记录上一网格中心坐标，用于在两点之间遍历
  const lastCenterRef = useRef<{ x: number; y: number } | null>(null)

  const checked = operation === 'Mosaic'

  const selectMosaic = useCallback(() => {
    operationDispatcher.set('Mosaic')
    cursorDispatcher.set('crosshair')
  }, [operationDispatcher, cursorDispatcher])

  const onSelectMosaic = useCallback(() => {
    if (checked) {
      return
    }
    selectMosaic()
    historyDispatcher.clearSelect()
  }, [checked, selectMosaic, historyDispatcher])

  // 将任意点(x, y)吸附到马赛克网格中心
  const snapToGridCenter = useCallback(
    (x: number, y: number, blockSize: number) => {
      const half = blockSize / 2
      const gx = Math.floor(x / blockSize) * blockSize + half
      const gy = Math.floor(y / blockSize) * blockSize + half
      return { x: Math.floor(gx), y: Math.floor(gy) }
    },
    []
  )

  // 添加一个以网格中心为单位的马赛克块（去重 + 颜色平均）
  const addMosaicCell = useCallback(
    (cx: number, cy: number, blockSize: number) => {
      if (!imageDataRef.current || !mosaicRef.current) return

      const key = `${cx},${cy}`
      if (visitedKeyRef.current.has(key)) return

      const color = getAverageBlockColor(
        cx,
        cy,
        blockSize,
        imageDataRef.current
      )
      mosaicRef.current.data.tiles.push({ x: cx, y: cy, color })
      visitedKeyRef.current.add(key)
    },
    []
  )

  // 在两点之间按固定步长遍历，确保连续
  const traverseBetween = useCallback(
    (x0: number, y0: number, x1: number, y1: number, blockSize: number) => {
      const dx = x1 - x0
      const dy = y1 - y0
      const dist = Math.hypot(dx, dy)
      if (dist === 0) return

      const step = Math.max(1, Math.floor(blockSize / 2))
      const steps = Math.ceil(dist / step)
      const inv = 1 / steps

      for (let i = 1; i <= steps; i++) {
        const t = i * inv
        const px = x0 + dx * t
        const py = y0 + dy * t
        const { x: cx, y: cy } = snapToGridCenter(px, py, blockSize)
        addMosaicCell(cx, cy, blockSize)
      }
    },
    [addMosaicCell, snapToGridCenter]
  )

  const onMousedown = useCallback(
    (e: MouseEvent): void => {
      if (
        !checked ||
        mosaicRef.current ||
        !imageDataRef.current ||
        !canvasContextRef.current
      ) {
        return
      }

      const rect = canvasContextRef.current.canvas.getBoundingClientRect()
      const x = e.clientX - rect.x
      const y = e.clientY - rect.y
      const mosaicSize = Math.max(2, size * 2)

      const { x: cx, y: cy } = snapToGridCenter(x, y, mosaicSize)

      visitedKeyRef.current.clear()
      lastCenterRef.current = { x: cx, y: cy }

      const color = getAverageBlockColor(
        cx,
        cy,
        mosaicSize,
        imageDataRef.current
      )

      mosaicRef.current = {
        name: 'Mosaic',
        type: HistoryItemType.Source,
        data: {
          size: mosaicSize,
          tiles: [{ x: cx, y: cy, color }]
        },
        editHistory: [],
        draw
      }
      visitedKeyRef.current.add(`${cx},${cy}`)
    },
    [checked, size, canvasContextRef, snapToGridCenter]
  )

  const onMousemove = useCallback(
    (e: MouseEvent): void => {
      if (
        !checked ||
        !mosaicRef.current ||
        !canvasContextRef.current ||
        !imageDataRef.current
      ) {
        return
      }

      const rect = canvasContextRef.current.canvas.getBoundingClientRect()
      const x = e.clientX - rect.x
      const y = e.clientY - rect.y

      const mosaicSize = mosaicRef.current.data.size

      const { x: cx, y: cy } = snapToGridCenter(x, y, mosaicSize)

      const last = lastCenterRef.current
      if (!last) {
        addMosaicCell(cx, cy, mosaicSize)
        lastCenterRef.current = { x: cx, y: cy }
      } else {
        traverseBetween(last.x, last.y, cx, cy, mosaicSize)
        lastCenterRef.current = { x: cx, y: cy }
      }

      if (history.top !== mosaicRef.current) {
        historyDispatcher.push(mosaicRef.current)
      } else {
        historyDispatcher.set(history)
      }
    },
    [
      checked,
      canvasContextRef,
      history,
      historyDispatcher,
      addMosaicCell,
      snapToGridCenter,
      traverseBetween
    ]
  )

  const onMouseup = useCallback(() => {
    if (!checked) {
      return
    }

    mosaicRef.current = null
    lastCenterRef.current = null
    visitedKeyRef.current.clear()
  }, [checked])

  useCanvasMousedown(onMousedown)
  useCanvasMousemove(onMousemove)
  useCanvasMouseup(onMouseup)

  useEffect(() => {
    if (!bounds || !image || !checked) {
      return
    }

    const $canvas = document.createElement('canvas')

    const canvasContext = $canvas.getContext('2d')

    if (!canvasContext) {
      return
    }

    $canvas.width = bounds.width
    $canvas.height = bounds.height

    const rx = image.naturalWidth / width
    const ry = image.naturalHeight / height

    canvasContext.drawImage(
      image,
      bounds.x * rx,
      bounds.y * ry,
      bounds.width * rx,
      bounds.height * ry,
      0,
      0,
      bounds.width,
      bounds.height
    )

    imageDataRef.current = canvasContext.getImageData(
      0,
      0,
      bounds.width,
      bounds.height
    )
  }, [width, height, bounds, image, checked])

  return (
    <ScreenshotsButton
      title={lang.operation_mosaic_title}
      icon='icon-shotz-stroke-thin-mosaic'
      checked={checked}
      onClick={onSelectMosaic}
      option={<ScreenshotsSize value={size} onChange={setSize} />}
    />
  )
}
