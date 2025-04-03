import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';
import { Box } from 'shared-components';
import RumorsPage from './pages/RumorsPage';
import LandingPage from './pages/LandingPage';

const AppRoutes = () => {
  const { universalAddress } = usePushWalletContext();

  return (
    <Box display="flex" justifyContent="center" minHeight="100vh">
      <Routes>
        <Route
          path="/"
          element={universalAddress ? <RumorsPage /> : <LandingPage />}
        />

        <Route
          path="/"
          element={universalAddress ? <RumorsPage /> : <Navigate to="/" />}
        />

        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Box>
  );
};

export default AppRoutes;
