// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "./ERC7303.sol";

/**
 * TCTCDemoToken — ERC-7303 target contract for the tctc-mcp demo
 *
 * safeMint is gated by MINTER_ROLE, burn by BURNER_ROLE; both roles are
 * bound to AgentControlTokens (typeId 1 = MinterCert, 2 = BurnerCert).
 */
contract TCTCDemoToken is ERC721, ERC7303 {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    uint256 private _nextTokenId;

    constructor(address controlTokens) ERC721("TCTC Demo Token", "TCTCD") {
        _grantRoleByERC1155(MINTER_ROLE, controlTokens, 1);
        _grantRoleByERC1155(BURNER_ROLE, controlTokens, 2);
    }

    function _baseURI() internal pure override returns (string memory) {
        return "https://kofujimura.github.io/sample-NFT-metadata/assets/";
    }

    function safeMint(address to)
        public
        onlyHasToken(MINTER_ROLE, msg.sender)
        returns (uint256 tokenId)
    {
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
    }

    function burn(uint256 tokenId) public onlyHasToken(BURNER_ROLE, msg.sender) {
        _burn(tokenId);
    }
}
