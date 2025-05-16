import React from 'react';
import styled from 'styled-components';
import { Spinner } from "../../components/common";

const PushWalletToast = () => {
    return (
        <ToastContainer>
            <Spinner />
            <TitleText>Sending Transaction</TitleText>
        </ToastContainer>
    );
};

export { PushWalletToast };

const ToastContainer = styled.div`
    position: fixed;
    bottom: 40px;
    right: 30px;
    display:flex;
    flex-direction:row;
    gap:12px;
    align-items:center;
    border:1px solid whitesmoke;
    padding:10px 20px;
    border-radius:10px;
    background-color:#fff;
`

const TitleText = styled.h4`
    font-size:18px;
    font-weight:400;
    margin:0;
`