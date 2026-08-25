import { createContext, useContext, useState, ReactNode } from "react";

interface TenantNavContextValue {
  isOpen: boolean;
  open:   () => void;
  close:  () => void;
  toggle: () => void;
}

const TenantNavContext = createContext<TenantNavContextValue>({
  isOpen: false,
  open:   () => {},
  close:  () => {},
  toggle: () => {},
});

export function TenantNavProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <TenantNavContext.Provider value={{
      isOpen,
      open:   () => setIsOpen(true),
      close:  () => setIsOpen(false),
      toggle: () => setIsOpen((v) => !v),
    }}>
      {children}
    </TenantNavContext.Provider>
  );
}

export function useTenantNav() {
  return useContext(TenantNavContext);
}
