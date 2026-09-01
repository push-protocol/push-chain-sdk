import React from 'react';

const ArrowUpRight = ({
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
            viewBox="0 0 28 28"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path
              d="M8 20L20 8M20 8H8M20 8V20"
              stroke={color}
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
        </svg>
    );
};

export default ArrowUpRight;
