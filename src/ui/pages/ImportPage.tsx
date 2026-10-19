import { Link } from 'react-router'
import { buttonVariants } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { PageHeader } from '../components/PageHeader'
import { NEW_TRANSACTION } from '../nav'

export function ImportPage() {
  return (
    <>
      <PageHeader title="นำเข้าข้อมูล" />
      <Card className="grid gap-4">
        <p className="text-ink-2">นำเข้าจากรูปแคปหรือไฟล์ด้วย AI จะมาในเฟส 1.5 · ระหว่างนี้กรอกยอดยกมาหรือบันทึกรายการเองได้</p>
        <div className="flex flex-wrap gap-2.5">
          <Link to={`${NEW_TRANSACTION}?type=opening`} className={buttonVariants()}>
            กรอกยอดยกมา
          </Link>
          <Link to={NEW_TRANSACTION} className={buttonVariants({ variant: 'outline' })}>
            บันทึกรายการ
          </Link>
        </div>
      </Card>
    </>
  )
}
