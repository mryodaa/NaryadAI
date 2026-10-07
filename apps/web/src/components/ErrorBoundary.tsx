// Ловит ошибку в дочернем дереве (например, не загрузился чанк 3D) и сообщает наверх.
import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ onError?: (error: unknown) => void; fallback?: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError?.(error);
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
