// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

contract ABC {
    function encodeText(string calldata _text) public pure returns(bytes memory) {
        return abi.encode(_text);
    }

    // Best function ever
    function trim(string calldata str, uint start, uint end) public pure returns(string memory) {
        return str[start:end];
    }

    function hexStringToAddress(string calldata s) public pure returns (bytes memory) {
        bytes memory ss = bytes(s);
        require(ss.length%2 == 0); // length must be even
        bytes memory r = new bytes(ss.length/2);
        for (uint i=0; i<ss.length/2; ++i) {
            r[i] = bytes1(fromHexChar(uint8(ss[2*i])) * 16 +
                        fromHexChar(uint8(ss[2*i+1])));
        }
        return r;
    }

    function fromHexChar(uint8 c) public pure returns (uint8) {
        if (bytes1(c) >= bytes1('0') && bytes1(c) <= bytes1('9')) {
            return c - uint8(bytes1('0'));
        }
        if (bytes1(c) >= bytes1('a') && bytes1(c) <= bytes1('f')) {
            return 10 + c - uint8(bytes1('a'));
        }
        if (bytes1(c) >= bytes1('A') && bytes1(c) <= bytes1('F')) {
            return 10 + c - uint8(bytes1('A'));
        }
        return 0;
    }

    function toAddress(string calldata s) public pure returns (address) {
        bytes memory _bytes = hexStringToAddress(s);
        require(_bytes.length >= 1 + 20, "toAddress_outOfBounds");
        address tempAddress;
        assembly {
            tempAddress := div(mload(add(add(_bytes, 0x20), 1)), 0x1000000000000000000000000)
        }
        return tempAddress;
    }

    // This is the main function to convert text into 2 addresses for swaps
    function processData(bytes memory _text) public view returns (address, address){
        string memory data = abi.decode(_text, (string)); // abi-decoding of the sent text
        address myAddress1 = this.toAddress(this.trim(data, 0, 42));
        address myAddress2 = this.toAddress(this.trim(data, 42, 84));
        return (myAddress1, myAddress2);
    }

    // This is the main function to convert text into 2 addresses for swaps
    function processDataString(string memory _text) public view returns (address, address){
        address myAddress1 = this.toAddress(this.trim(_text, 0, 42));
        address myAddress2 = this.toAddress(this.trim(_text, 42, 84));
        return (myAddress1, myAddress2);
    }
}