import { useNavigate, NavigateOptions, To } from 'react-router-dom';

export function useViewTransitionNavigate() {
  const navigate = useNavigate();

  return (to: To | number, options?: NavigateOptions) => {
    if (typeof to === 'number') {
      if (document.startViewTransition) {
        document.startViewTransition(() => {
          navigate(to);
        });
      } else {
        navigate(to);
      }
      return;
    }

    if (document.startViewTransition) {
      document.startViewTransition(() => {
        navigate(to, options);
      });
    } else {
      navigate(to, options);
    }
  };
}
