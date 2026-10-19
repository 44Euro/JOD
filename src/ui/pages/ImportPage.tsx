import { Link } from 'react-router'
import { buttonVariants } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { cn } from '../../lib/cn'
import { PageHeader } from '../components/PageHeader'
import { NEW_TRANSACTION } from '../nav'

export function ImportPage() {
  return (
    <>
      <PageHeader title="นำเข้าข้อมูล" />
      <Card className="grid gap-4">
        <p className="text-ink-2">นำเข้าจากรูปแคปหรือไฟล์ด้วย AI จะมาในเฟส 1.5 · ระหว่างนี้กรอกยอดยกมาหรือบันทึกรายการเองได้</p>
        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
          <Link to={`${NEW_TRANSACTION}?type=opening`} className={cn(buttonVariants(), 'w-full sm:w-auto')}>
            กรอกยอดยกมา
          </Link>
          <Link to={NEW_TRANSACTION} className={cn(buttonVariants({ variant: 'outline' }), 'w-full sm:w-auto')}>
            บันทึกรายการ
          </Link>
        </div>
      </Card>
    </>
  )
}
