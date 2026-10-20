import { useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { checkForUpdate, openUpdateTerminal } from '@/lib/api'
import type { UpdateCheckResult } from '@/lib/types'

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** The running host's version, with an on-demand npm check and the same update terminal as the board's notice. */
export function UpdateCheckSection({ appVersion }: { appVersion: string | null | undefined }) {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<UpdateCheckResult | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)

  const check = () => {
    setChecking(true)
    setCheckError(null)
    setLaunchError(null)
    void checkForUpdate()
      .then(setResult)
      .catch((error) => {
        setResult(null)
        setCheckError(errorText(error, '無法連線到 npm registry'))
      })
      .finally(() => setChecking(false))
  }

  const launch = () => {
    setLaunching(true)
    setLaunchError(null)
    void openUpdateTerminal()
      .catch((error) => setLaunchError(errorText(error, '無法開啟更新終端機')))
      .finally(() => setLaunching(false))
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          VibeFlow 版本：{appVersion === undefined ? '讀取中…' : appVersion ? `v${appVersion}` : '無法取得'}
        </p>
        <Button variant="outline" size="sm" disabled={checking} onClick={check}>
          {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {checking ? '檢查中…' : '檢查更新'}
        </Button>
      </div>
      {checkError && <p role="alert" className="text-sm text-destructive">檢查更新失敗：{checkError}</p>}
      {result?.status === 'current' && (
        <p role="status" className="text-sm text-muted-foreground">已是最新版本（v{result.currentVersion}）。</p>
      )}
      {result?.status === 'unsupported' && (
        <p role="status" className="text-sm text-muted-foreground">
          目前不是全域 npm 安裝（例如原始碼執行），無法從這裡更新。
        </p>
      )}
      {result?.status === 'available' && (
        <div role="status" className="space-y-2 rounded-md border border-border bg-primary/10 p-3 text-sm">
          <p>
            VibeFlow v{result.latestVersion} 已發布（目前 v{result.currentVersion}）。
            按下更新會開啟系統終端機執行更新指令（Windows：<code>vibeflow update</code>；其他平台：<code>sudo vibeflow update</code>）。安裝完成後 host 會自動重新啟動。
          </p>
          <Button size="sm" disabled={launching} onClick={launch}>
            {launching ? '開啟中…' : '更新 VibeFlow'}
          </Button>
          {launchError && <p role="alert" className="text-destructive">{launchError}</p>}
        </div>
      )}
    </section>
  )
}
