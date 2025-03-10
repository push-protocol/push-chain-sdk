import React, { ReactNode } from 'react';
import { useGlobalContext } from '../context/GlobalContext';
import { Navigate } from 'react-router-dom';

const PrivateRoute = ({ children }: { children: ReactNode }) => {
  const { universalAddress } = useGlobalContext();

  if (universalAddress) return <>{children}</>;

  return <Navigate to={'/'} />;
};

export { PrivateRoute };
