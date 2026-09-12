import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
const variants = cva('button', {
  variants: {
    variant: { primary: 'primary', secondary: 'secondary', ghost: 'ghost', danger: 'danger' },
    size: { normal: '', small: 'small', icon: 'icon-button' },
  },
  defaultVariants: { variant: 'secondary', size: 'normal' },
});
export function Button({
  variant,
  size,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof variants>) {
  return <button className={clsx(variants({ variant, size }), className)} {...props} />;
}
