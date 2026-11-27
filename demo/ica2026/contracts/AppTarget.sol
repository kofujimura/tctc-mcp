// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "./ERC7303.sol";

/**
 * AppTarget — the on-chain side of one application's access rule.
 *
 * An application that is not itself a contract (an MCP server behind a
 * gateway, a web API) still needs a place to declare which tokens satisfy
 * its roles. This contract is that declaration and nothing else: a name,
 * and for each role the ERC-1155 token types that satisfy it, fixed at
 * deployment. The application's enforcement point calls hasRole() here; a
 * dashboard discovers the bindings through IERC7303.
 *
 * It lists no members and holds no keys. Who may use the application is
 * decided by who holds the tokens, which their issuers mint and burn.
 */
contract AppTarget is ERC165, ERC7303 {
    struct Binding {
        bytes32 role;
        address controlToken;
        uint256 typeId;
    }

    string public name;

    constructor(string memory name_, Binding[] memory bindings) {
        name = name_;
        for (uint256 i = 0; i < bindings.length; i++) {
            _grantRoleByERC1155(bindings[i].role, bindings[i].controlToken, bindings[i].typeId);
        }
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC7303).interfaceId || super.supportsInterface(interfaceId);
    }
}
