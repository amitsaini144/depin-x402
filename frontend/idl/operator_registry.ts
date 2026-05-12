/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/operator_registry.json`.
 */
export type OperatorRegistry = {
  "address": "38X2K9cy8m4LnvtRmhFWs6TRuxCZV24znbBqCDJaAPXT",
  "metadata": {
    "name": "operatorRegistry",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "deregisterOperator",
      "discriminator": [
        229,
        98,
        238,
        100,
        57,
        56,
        156,
        124
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "operatorRecord"
          ]
        },
        {
          "name": "operatorRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  112,
                  101,
                  114,
                  97,
                  116,
                  111,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "operatorTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "registerOperator",
      "discriminator": [
        49,
        242,
        151,
        125,
        212,
        136,
        31,
        89
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "operatorTokenAccount",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "operatorRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  112,
                  101,
                  114,
                  97,
                  116,
                  111,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "endpointUrl",
          "type": "string"
        },
        {
          "name": "region",
          "type": "string"
        },
        {
          "name": "stakeAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "slashOperator",
      "docs": [
        "Slash an operator who was active but processed zero payments in a completed epoch.",
        "",
        "Proof is the operator's OperatorStats PDA from the settlement program.",
        "Challenger earns 10% of vault balance. 90% stays locked.",
        "A SlashRecord PDA is created to prevent replaying the same epoch.",
        "",
        "# Arguments",
        "* `target_epoch` — the epoch number being slashed (must be complete)"
      ],
      "discriminator": [
        93,
        188,
        89,
        82,
        93,
        198,
        107,
        167
      ],
      "accounts": [
        {
          "name": "challenger",
          "docs": [
            "Anyone can be a challenger — no auth required"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "challengerTokenAccount",
          "docs": [
            "Challenger's token account to receive the 10% slash reward"
          ],
          "writable": true
        },
        {
          "name": "operatorRecord",
          "docs": [
            "The operator being slashed"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  112,
                  101,
                  114,
                  97,
                  116,
                  111,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "operator_record.authority",
                "account": "operatorRecord"
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "Operator's stake vault — funds are transferred from here"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "operator_record.authority",
                "account": "operatorRecord"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "operatorStats"
        },
        {
          "name": "slashRecord",
          "docs": [
            "SlashRecord PDA — created here, prevents replay for same operator+epoch"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  108,
                  97,
                  115,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "operator_record.authority",
                "account": "operatorRecord"
              },
              {
                "kind": "arg",
                "path": "targetEpoch"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "targetEpoch",
          "type": "i64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "operatorRecord",
      "discriminator": [
        49,
        186,
        37,
        73,
        176,
        228,
        99,
        33
      ]
    },
    {
      "name": "slashRecord",
      "discriminator": [
        107,
        134,
        175,
        65,
        150,
        130,
        94,
        68
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "urlTooLong",
      "msg": "Endpoint URL must be 128 characters or less"
    },
    {
      "code": 6001,
      "name": "insufficientStake",
      "msg": "Stake amount is below minimum required"
    },
    {
      "code": 6002,
      "name": "notActive",
      "msg": "Operator is not active"
    },
    {
      "code": 6003,
      "name": "epochNotComplete",
      "msg": "Epoch is not yet complete — cannot slash a live epoch"
    },
    {
      "code": 6004,
      "name": "hasPayments",
      "msg": "Operator had payments this epoch — not slashable"
    },
    {
      "code": 6005,
      "name": "rewardsClaimed",
      "msg": "Operator already claimed rewards — not slashable"
    },
    {
      "code": 6006,
      "name": "alreadySlashed",
      "msg": "This epoch has already been slashed for this operator"
    },
    {
      "code": 6007,
      "name": "invalidStatsOwner",
      "msg": "OperatorStats account does not belong to settlement program"
    },
    {
      "code": 6008,
      "name": "invalidStatsPda",
      "msg": "OperatorStats PDA seeds do not match operator"
    },
    {
      "code": 6009,
      "name": "emptyVault",
      "msg": "Vault has no stake to slash"
    },
    {
      "code": 6010,
      "name": "epochMismatch",
      "msg": "OperatorStats epoch does not match the slash target epoch"
    }
  ],
  "types": [
    {
      "name": "operatorRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "endpointUrl",
            "type": "string"
          },
          {
            "name": "region",
            "type": "string"
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "registeredAt",
            "type": "i64"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "totalVolume",
            "type": "u64"
          },
          {
            "name": "score",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "slashRecord",
      "docs": [
        "Created once per (operator, epoch) slash event.",
        "Its existence on-chain is the replay guard."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "epoch",
            "type": "i64"
          },
          {
            "name": "challenger",
            "type": "pubkey"
          },
          {
            "name": "slashAmount",
            "type": "u64"
          },
          {
            "name": "slashedAt",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
