import { Eye, EyeOff, type LucideIcon } from 'lucide-react'
import { useState, type ComponentProps } from 'react'
import { Input } from '../../components/ui/input'
import { t } from '../../i18n'
import { cn } from '../../lib/cn'

// A field with its icon inside, and for passwords a button to show what was typed.
export function IconInput({
  id,
  icon: Icon,
  type,
  reveal,
  className,
  ...props
}: { id: string; icon: LucideIcon; reveal?: boolean } & ComponentProps<'input'>) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input id={id} type={reveal && shown ? 'text' : type} className={cn('h-12 bg-card pr-12 pl-11', className)} {...props} />
      {reveal && (
        <button
          type="button"
          aria-label={shown ? t('ซ่อนรหัสผ่าน') : t('แสดงรหัสผ่าน')}
          aria-pressed={shown}
          className="absolute top-1/2 right-2 grid size-10 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          onClick={() => setShown(!shown)}
        >
          {shown ? <Eye className="size-5" aria-hidden /> : <EyeOff className="size-5" aria-hidden />}
        </button>
      )}
    </div>
  )
}
