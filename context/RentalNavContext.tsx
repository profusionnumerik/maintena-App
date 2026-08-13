import { createContext, useContext, useState, ReactNode } from "react";

interface RentalNavContextValue {
  isOpen:  boolean;
  open:    () => void;
  close:   () => void;
  toggle:  () => void;
}

const RentalNavContext = createContext<RentalNavContextValue>({
  isOpen: false,
  open:   () => {},
  close:  () => {},
  toggle: () => {},
});

export function RentalNavProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <RentalNavContext.Provider value={{
      isOpen,
      open:   () => setIsOpen(true),
      close:  () => setIsOpen(false),
      toggle: () => setIsOpen((v) => !v),
    }}>
      {children}
    </RentalNavContext.Provider>
  );
}

export function useRentalNav() {
  return useContext(RentalNavContext);
}
