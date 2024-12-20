import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/login';
import LoggedInView from './components/logged-in-view';

const AppRoutes: React.FC<{ authenticated: boolean; pushAccount: boolean }> = ({
  authenticated,
  pushAccount,
}) => {
  return (
    <Routes>
      <Route
        path="/"
        element={
          authenticated || pushAccount ? <Navigate to="/inbox" /> : <Login />
        }
      />

      <Route
        path="/"
        element={
          authenticated || pushAccount ? <LoggedInView /> : <Navigate to="/" />
        }
      >
        <Route path="inbox" element={<LoggedInView />} />
        <Route path="inbox/:id" element={<LoggedInView />} />
        <Route path="sent" element={<LoggedInView />} />
        <Route path="sent/:id" element={<LoggedInView />} />
      </Route>

      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
};

export default AppRoutes;
