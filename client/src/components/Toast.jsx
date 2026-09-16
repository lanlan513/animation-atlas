import React, { useCallback, useRef, useState } from 'react';
import { CircleAlert, Info, X } from 'lucide-react';

export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const showToast = useCallback((message, kind = 'error') => {
    clearTimeout(timer.current);
    setToast({ message, kind, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  const dismissToast = useCallback(() => { clearTimeout(timer.current); setToast(null); }, []);
  return { toast, showToast, dismissToast };
}

export default function Toast({ toast, onClose }) {
  return (
    <div className={`toast ${toast.kind === 'info' ? 'info' : 'error'}`}>
      {toast.kind === 'info' ? <Info size={17} /> : <CircleAlert size={17} />}
      <span>{toast.message}</span>
      <button onClick={onClose} aria-label="关闭提示"><X size={16} /></button>
    </div>
  );
}
