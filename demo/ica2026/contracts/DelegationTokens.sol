// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./ERC7303.sol";

/**
 * DelegationTokens — control tokens a person issues to their own agents,
 * where the right to issue is itself a token.
 *
 * The surface is that of AgentControlTokens: soulbound, owner mint, and
 * burnByIssuer as the kill switch. One rule is added: mint also requires
 * the owner to hold ISSUER_ROLE, bound at deployment to a credential that
 * someone else issues (an employee ID, say). This is ERC-7303 applied to
 * the issuer: token-controlled token circulation.
 *
 * If that credential is burned, the owner can delegate nothing new.
 * Burning existing delegations needs no role, so stopping an agent never
 * depends on a third party.
 */
contract DelegationTokens is ERC1155, Ownable, ERC7303 {
    string public name;

    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    mapping(uint256 => string) private _tokenURIs;

    error Soulbound();

    constructor(string memory name_, address credential, uint256 credentialTypeId)
        ERC1155("")
        Ownable(msg.sender)
    {
        name = name_;
        _grantRoleByERC1155(ISSUER_ROLE, credential, credentialTypeId);
    }

    function setTokenURI(uint256 id, string calldata tokenURI_) external onlyOwner {
        _tokenURIs[id] = tokenURI_;
    }

    function uri(uint256 id) public view override returns (string memory) {
        return _tokenURIs[id];
    }

    function mint(address to, uint256 id, uint256 amount)
        external
        onlyOwner
        onlyHasToken(ISSUER_ROLE, msg.sender)
    {
        _mint(to, id, amount, "");
    }

    function burnByIssuer(address account, uint256 id, uint256 amount) external onlyOwner {
        _burn(account, id, amount);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC7303).interfaceId || super.supportsInterface(interfaceId);
    }

    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override {
        if (from != address(0) && to != address(0)) revert Soulbound();
        super._update(from, to, ids, values);
    }
}
