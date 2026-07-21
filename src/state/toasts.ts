import { create } from 'zustand'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  title: string
  message?: string
  undo?: () => void
}

interface ToastState {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++
    set({ toasts: [...get().toasts, { ...t, id }] })
    setTimeout(() => get().dismiss(id), t.undo ? 8000 : 4500)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}))
