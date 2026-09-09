import { useCopy } from '@/lib/client/useCopy';
import { buttonClass, primaryButtonClass } from './incidentUi';

/**
 * A button that copies `value` and reads "Copied" for a moment. Self-contained
 * so a list can drop one next to every value without threading state.
 */
export function CopyButton({
  value,
  label = 'Copy',
  primary = false,
  className,
}: {
  value: string;
  label?: string;
  /** The red call-to-action style, for the one link the placement says to paste. */
  primary?: boolean;
  className?: string;
}) {
  const { copied, copy } = useCopy();
  const base = primary ? `${primaryButtonClass} !px-3 !py-2 !text-xs` : buttonClass;
  return (
    <button
      type="button"
      onClick={() => void copy('value', value)}
      disabled={!value}
      className={className ? `${base} ${className}` : base}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}
