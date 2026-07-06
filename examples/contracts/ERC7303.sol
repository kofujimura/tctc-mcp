// SPDX-License-Identifier: Apache-2.0
// Author: Ko Fujimura <ko@fujimura.com>
// Open source repo: https://github.com/kofujimura/TCTC

pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

abstract contract ERC7303 {
    struct ERC721Token {
        address contractId;
    }

    struct ERC1155Token {
        address contractId;
        uint256 typeId;
    }

    mapping (bytes32 => ERC721Token[]) private _ERC721_Contracts;
    mapping (bytes32 => ERC1155Token[]) private _ERC1155_Contracts;

    modifier onlyHasToken(bytes32 role, address account) {
        require(_checkHasToken(role, account), "ERC7303: not has a required token");
        _;
    }

    /**
     * @notice Grant a role to user who owns a control token specified by the ERC-721 contractId.
     * Multiple calls are allowed, in this case the user must own at least one of the specified token.
     * @param role byte32 The role which you want to grant.
     * @param contractId address The address of contractId of which token the user required to own.
     */
    function _grantRoleByERC721(bytes32 role, address contractId) internal {
        require(
            IERC165(contractId).supportsInterface(type(IERC721).interfaceId),
            "ERC7303: provided contract does not support ERC721 interface"
        );
        _ERC721_Contracts[role].push(ERC721Token(contractId));
    }

    /**
     * @notice Grant a role to user who owns a control token specified by the ERC-1155 contractId.
     * Multiple calls are allowed, in this case the user must own at least one of the specified token.
     * @param role byte32 The role which you want to grant.
     * @param contractId address The address of contractId of which token the user required to own.
     * @param typeId uint256 The token type id that the user required to own.
     */
    function _grantRoleByERC1155(bytes32 role, address contractId, uint256 typeId) internal {
        require(
            IERC165(contractId).supportsInterface(type(IERC1155).interfaceId),
            "ERC7303: provided contract does not support ERC1155 interface"
        );
        _ERC1155_Contracts[role].push(ERC1155Token(contractId, typeId));
    }

    function _checkHasToken(bytes32 role, address account) internal view returns (bool) {
        ERC721Token[] memory ERC721Tokens = _ERC721_Contracts[role];
        for (uint i = 0; i < ERC721Tokens.length; i++) {
            if (IERC721(ERC721Tokens[i].contractId).balanceOf(account) > 0) return true;
        }

        ERC1155Token[] memory ERC1155Tokens = _ERC1155_Contracts[role];
        for (uint i = 0; i < ERC1155Tokens.length; i++) {
            if (IERC1155(ERC1155Tokens[i].contractId).balanceOf(account, ERC1155Tokens[i].typeId) > 0) return true;
        }

        return false;
    }
}
