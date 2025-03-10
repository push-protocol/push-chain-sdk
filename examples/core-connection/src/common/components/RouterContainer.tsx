import React, { useEffect } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import LandingPage from '../../pages/LandingPage';
import { Box } from 'shared-components';
import SimulatePage from '../../pages/SimulatePage';
import { PrivateRoute } from '../../pages/PrivateRoute';
import { APP_ROUTES } from '../constants';
import { useGlobalContext } from '../../context/GlobalContext';

const RouterContainer = () => {
  const { universalAddress } = useGlobalContext();
  const navigate = useNavigate();
  useEffect(() => {
    if (universalAddress) {
      navigate(APP_ROUTES.SIMULATE);
    }
  }, [universalAddress]);

  return (
    <Box display="flex" justifyContent="center" minHeight="100vh">
      <Routes>
        <Route path={APP_ROUTES.LANDING_PAGE} element={<LandingPage />} />
        <Route
          path={APP_ROUTES.SIMULATE}
          element={
            <PrivateRoute>
              <SimulatePage />
            </PrivateRoute>
          }
        />
      </Routes>
    </Box>
  );
};

export { RouterContainer };
