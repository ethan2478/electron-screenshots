import React, { useCallback, useEffect, useState } from 'react'
import Screenshots from '../Screenshots'
import { Bounds } from '../Screenshots/types'
import { Lang } from '../Screenshots/zh_CN'
import './app.less'

export interface Display {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export default function App (): JSX.Element {
  const [url, setUrl] = useState<string | undefined>(undefined)
  const [width, setWidth] = useState(window.innerWidth)
  const [height, setHeight] = useState(window.innerHeight)
  const [display, setDisplay] = useState<Display | undefined>(undefined)
  const [lang, setLang] = useState<Lang | undefined>(undefined)
  const [enabled, setEnabled] = useState(true)

  const onSave = useCallback(
    async (blob: Blob | null, bounds: Bounds) => {
      if (!display || !blob) {
        return
      }
      window.screenshots.save(await blob.arrayBuffer(), { bounds, display })
    },
    [display]
  )

  const onCancel = useCallback(() => {
    window.screenshots.cancel()
  }, [])

  const onOk = useCallback(
    async (blob: Blob | null, bounds: Bounds) => {
      if (!display || !blob) {
        return
      }
      window.screenshots.ok(await blob.arrayBuffer(), { bounds, display })
    },
    [display]
  )

  const onBoundsChange = useCallback((bounds: Bounds | null) => {
    // 通知正在截图
    if (bounds) {
      window.screenshots.activate()
    }
  }, [])

  useEffect(() => {
    const onSetLang = (lang: Lang) => {
      console.log('app onSetLang==>>', lang)
      setLang(lang)
    }

    const onCapture = (display: Display, dataURL: string) => {
      console.log('app onCapture==>>', JSON.stringify(display), dataURL.length)
      setDisplay(display)
      setUrl(dataURL)
    }

    const onReset = () => {
      console.log('app onReset')
      setUrl(undefined)
      setDisplay(undefined)
    }

    const onActiveDisplayIdChange = (activeDisplayId: number) => {
      if (
        activeDisplayId.toString() !== window.screenshots.displayId?.toString()
      ) {
        setEnabled(false)
      }
    }

    window.screenshots.on('activeDisplayIdChange', onActiveDisplayIdChange)
    window.screenshots.on('setLang', onSetLang)
    window.screenshots.on('capture', onCapture)
    window.screenshots.on('reset', onReset)

    console.log('app ready==>>')
    // 告诉主进程页面准备完成
    window.screenshots.ready()

    return () => {
      window.screenshots.off('capture', onCapture)
      window.screenshots.off('setLang', onSetLang)
      window.screenshots.off('reset', onReset)
    }
  }, [])

  useEffect(() => {
    const onResize = () => {
      setWidth(window.innerWidth)
      setHeight(window.innerHeight)
    }

    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [onCancel])

  return (
    <div className='body'>
      <Screenshots
        enabled={enabled}
        url={url}
        width={width}
        height={height}
        lang={lang}
        onSave={onSave}
        onCancel={onCancel}
        onOk={onOk}
        onBoundsChange={onBoundsChange}
      />
    </div>
  )
}
