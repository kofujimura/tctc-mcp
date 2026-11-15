// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "./ERC7303.sol";

/**
 * ReleaseRegistry — a contract whose one action is gated by a token.
 *
 * record() stores who recorded a release summary's hash. Only an account
 * holding AGENT_ROLE may call it, and AGENT_ROLE is bound at deployment to
 * one ERC-1155 token type: the same token an agent uses at off-chain
 * applications. Burn that token and this call reverts too.
 */
contract ReleaseRegistry is ERC165, ERC7303 {
    string public constant name = "Release registry";
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    /// summary hash => the account that recorded it
    mapping(bytes32 => address) public recordedBy;

    event ReleaseRecorded(bytes32 indexed summaryHash, address indexed by);

    error AlreadyRecorded(bytes32 summaryHash);

    constructor(address controlToken, uint256 typeId) {
        _grantRoleByERC1155(AGENT_ROLE, controlToken, typeId);
    }

    function record(bytes32 summaryHash) external onlyHasToken(AGENT_ROLE, msg.sender) {
        if (recordedBy[summaryHash] != address(0)) revert AlreadyRecorded(summaryHash);
        recordedBy[summaryHash] = msg.sender;
        emit ReleaseRecorded(summaryHash, msg.sender);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC7303).interfaceId || super.supportsInterface(interfaceId);
    }
}
