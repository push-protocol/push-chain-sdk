import React from 'react';
import styled from 'styled-components';

type AlertBarProps = {
  text: string;
  url?: string;
};

// Raw SVG for Star Icon
const StarIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="13"
    height="13"
    viewBox="0 0 13 13"
    fill="none"
  >
    <path
      d="M4.36441 6.55583L3.50508 7L4.36441 7.44417C5.51638 8.0396 6.4604 8.98362 7.05583 10.1356L7.49965 10.9943L7.94403 10.1359C8.54059 8.9835 9.4838 8.03951 10.6356 7.44417L11.4943 7.00035L10.6359 6.55597C9.4835 5.95941 8.53951 5.0162 7.94417 3.86441L7.50035 3.00575L7.05597 3.86413C6.45941 5.0165 5.5162 5.96049 4.36441 6.55583ZM1.5 6.75C4.67414 6.75 7.25 4.17414 7.25 1C7.25 0.862142 7.36214 0.75 7.5 0.75C7.63786 0.75 7.75 0.862142 7.75 1C7.75 4.17414 10.3259 6.75 13.5 6.75C13.6379 6.75 13.75 6.86214 13.75 7C13.75 7.13786 13.6379 7.25 13.5 7.25C10.3259 7.25 7.75 9.82586 7.75 13C7.75 13.1379 7.63786 13.25 7.5 13.25C7.36214 13.25 7.25 13.1379 7.25 13C7.25 9.82586 4.67414 7.25 1.5 7.25C1.36214 7.25 1.25 7.13786 1.25 7C1.25 6.86214 1.36214 6.75 1.5 6.75Z"
      fill="#CA37ED"
      stroke="#CA37ED"
    />
  </svg>
);

// Raw SVG for Arrow Icon
const ArrowIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="19"
    height="18"
    viewBox="0 0 19 18"
    fill="none"
  >
    <g clipPath="url(#clip0_12416_24075)">
      <path
        d="M3.13604 9.00001H15.864"
        stroke="#D548EC"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.6934 3.82928L15.8641 9L10.6934 14.1707"
        stroke="#D548EC"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
    <defs>
      <clipPath id="clip0_12416_24075">
        <rect width="18" height="18" fill="white" transform="translate(0.5)" />
      </clipPath>
    </defs>
  </svg>
);

const ChainAlertBar = ({ text, url }: AlertBarProps) => {
  return (
    <HeroButton
      onClick={() => {
        if (url) window.open(url, '_blank');
      }}
    >
      <StarIcon />
      <AlertText>{text}</AlertText>
      <ArrowIcon />
    </HeroButton>
  );
};

const HeroButton = styled.button`
  font-family: 'FK Grotesk Neue', sans-serif;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  gap: 8px;

  border-radius: 16px;
  border: 1.5px solid #f19aff;
  background: #fff;
  cursor: pointer;

  @media (max-width: 768px) {
    gap: 6px;
  }

  @media (max-width: 480px) {
    gap: 6px;
    padding: 12px 10px;
    box-sizing: border-box;
  }

  &:hover {
    background: #fff;
    border: 1.5px solid transparent;
  }
`;

const AlertText = styled.span`
  color: #000;
  font-family: 'N27', sans-serif;
  font-size: 16px;
  font-style: normal;
  font-weight: 400;
  line-height: 140%;

  @media (max-width: 768px) {
    font-size: 14px;
  }

  @media (max-width: 480px) {
    font-size: 14px;
  }
`;

export default ChainAlertBar;
