import { forwardRef, ButtonHTMLAttributes, ReactNode } from 'react';

// Icon-only button wrapper. `aria-label` is required at the type level so any
// consumer that forgets a label fails `tsc --noEmit` (enforced by the deploy
// typecheck gate in CLAUDE.md). Use this in place of raw `<button><Icon/></button>`
// patterns anywhere the button has no visible text.
//
// The child icon is auto-marked `aria-hidden` via a wrapping span — callers
// don't need to remember that boilerplate.

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  'aria-label': string;
  children: ReactNode;
};

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ children, type, ...rest }, ref) => (
    <button ref={ref} type={type ?? 'button'} {...rest}>
      <span aria-hidden="true" style={{ display: 'contents' }}>{children}</span>
    </button>
  )
);

IconButton.displayName = 'IconButton';

export default IconButton;
