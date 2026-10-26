import { useEffect } from 'react'
import { Link, useRouteError } from 'react-router'
import { buttonVariants } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { logError } from '../../errors/log'
import { cn } from '../../lib/cn'
import { ThemeSync } from '../theme'

// Replaces React Router's developer screen. The data is untouched by a page that failed to draw, so the way out is
// another page or a reload.
export function ErrorPage() {
  const error = useRouteError()
  const notFound = (error as { status?: number } | null)?.status === 404
  useEffect(() => {
    if (!notFound) logError(error)
  }, [error, notFound])
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4">
      <ThemeSync />
      <Card className="grid max-w-md gap-3">
        <h1 className="text-xl font-semibold">{notFound ? 'ไม่พบหน้านี้' : 'หน้านี้แสดงไม่ได้'}</h1>
        <p className="text-muted-foreground">
          {notFound
            ? 'ลิงก์อาจผิดหรือรายการถูกลบไปแล้ว'
            : 'เกิดปัญหาตอนแสดงหน้านี้ ข้อมูลของคุณยังอยู่ครบ · แอปเก็บรายละเอียดปัญหาไว้ในเครื่อง ส่งให้ผู้พัฒนาได้จากหน้าตั้งค่า'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to="/" className={buttonVariants()}>
            กลับหน้าภาพรวม
          </Link>
          {!notFound && (
            <button type="button" className={cn(buttonVariants({ variant: 'outline' }))} onClick={() => location.reload()}>
              โหลดใหม่
            </button>
          )}
        </div>
      </Card>
    </div>
  )
}
