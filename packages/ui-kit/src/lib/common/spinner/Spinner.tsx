import React from 'react';
import styled, { keyframes } from 'styled-components';
import { Ellipse } from '../icons';

// Keyframes for the spinning animation
const spin = keyframes`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`;

// Styled container for the Spinner
const Container = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ${spin} 1s linear infinite;
  width: 20px;
  height: 20px;
  color: #fff;
`;

// Spinner functional component
const Spinner = () => {
  return (
    <Container>
      <Ellipse />
    </Container>
  );
};

export default Spinner;
