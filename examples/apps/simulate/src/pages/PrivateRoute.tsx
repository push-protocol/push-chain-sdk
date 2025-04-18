import React, { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { usePushWalletContext } from '../../../../../packages/ui-kit';

const PrivateRoute = ({ children }: { children: ReactNode }) => {
  const { universalAddress } = usePushWalletContext();

  if (universalAddress) return <>{children}</>;

  return <Navigate to={'/'} />;
};

export { PrivateRoute };
