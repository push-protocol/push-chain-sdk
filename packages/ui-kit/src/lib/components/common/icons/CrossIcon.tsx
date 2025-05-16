import React from 'react';

const CrossIcon = ({
    height,
    width,
    color
}: {
    height: string;
    width: string;
    color: string;
}) => {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path
                d="M25.3552 7.51471L8.38466 24.4853"
                stroke={color}
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            ></path>
            <path
                d="M25.3552 24.4853L8.38466 7.51473"
                stroke={color}
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            ></path>
        </svg>
    );
};

export default CrossIcon;
