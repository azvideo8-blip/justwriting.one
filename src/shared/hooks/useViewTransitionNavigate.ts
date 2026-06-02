import { useNavigate, NavigateOptions, To } from 'react-router-dom';

export function useViewTransitionNavigate() {
  const navigate = useNavigate();

  return (to: To | number, options?: NavigateOptions) => {
    if (typeof to === 'number') {
      if (typeof document.startViewTransition === 'function') {
        void document.startViewTransition(() => {
          void navigate(to);
        });
      } else {
        void navigate(to);
      }
      return;
    }

    if (typeof document.startViewTransition === 'function') {
      void document.startViewTransition(() => {
        void navigate(to, options);
      });
    } else {
      void navigate(to, options);
    }
  };
}
