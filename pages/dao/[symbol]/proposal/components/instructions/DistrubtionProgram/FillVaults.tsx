/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { useContext, useEffect, useState } from 'react'
import * as yup from 'yup'
import { isFormValid } from '@utils/formValidation'
import { UiInstruction } from '@utils/uiTypes/proposalCreationTypes'
import useGovernanceAssets from '@hooks/useGovernanceAssets'
import {
  Governance,
  serializeInstructionToBase64,
} from '@solana/spl-governance'
import { ProgramAccount } from '@solana/spl-governance'
import { AccountType, AssetAccount } from '@utils/uiTypes/assets'
import useWalletOnePointOh from '@hooks/useWalletOnePointOh'
import { NewProposalContext } from '../../../new'
import InstructionForm, { InstructionInput } from '../FormCreator'
import { InstructionInputType } from '../inputInstructionType'
import {
  Distribution,
  MangoMintsRedemptionClient,
} from '@blockworks-foundation/mango-mints-redemption'
import { AnchorProvider } from '@coral-xyz/anchor'
import useLegacyConnectionContext from '@hooks/useLegacyConnectionContext'
import EmptyWallet from '@utils/Mango/listingTools'
import { Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js'
import { tryGetTokenAccount } from '@utils/tokens'
import Button from '@components/Button'
import { TOKEN_PROGRAM_ID, Token, u64 } from '@solana/spl-token'
import Input from '@components/inputs/Input'
import { parseMintNaturalAmountFromDecimal } from '@tools/sdk/units'

interface FillVaultsForm {
  governedAccount: AssetAccount | null
  distributionNumber: number
}

type Vault = {
  publicKey: PublicKey
  amount: bigint
  mintIndex: number
  mint: PublicKey
}

type Transfer = {
  from: PublicKey
  to: PublicKey
  amount: string
  decimals: number
  mintIndex: number
}

const FillVaults = ({
  index,
  governance,
}: {
  index: number
  governance: ProgramAccount<Governance> | null
}) => {
  const wallet = useWalletOnePointOh()
  const { assetAccounts } = useGovernanceAssets()
  const solAccounts = assetAccounts.filter((x) => x.type === AccountType.SOL)
  const connection = useLegacyConnectionContext()
  const shouldBeGoverned = !!(index !== 0 && governance)
  const [form, setForm] = useState<FillVaultsForm>({
    governedAccount: null,
    distributionNumber: 0,
  })
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [client, setClient] = useState<MangoMintsRedemptionClient>()
  const [distribution, setDistribution] = useState<Distribution>()
  const [vaults, setVaults] = useState<{ [pubkey: string]: Vault }>()
  const [formErrors, setFormErrors] = useState({})
  const { handleSetInstructions } = useContext(NewProposalContext)
  const validateInstruction = async (): Promise<boolean> => {
    const { isValid, validationErrors } = await isFormValid(schema, form)
    setFormErrors(validationErrors)
    return isValid
  }
  async function getInstruction(): Promise<UiInstruction> {
    const isValid = await validateInstruction()
    let serializedInstruction = ''
    const additionalSerializedInstructions: string[] = []
    const prerequisiteInstructions: TransactionInstruction[] = []
    if (
      isValid &&
      form.governedAccount?.governance?.account &&
      wallet?.publicKey &&
      vaults
    ) {
      for (const t of transfers) {
        const mintAmount = parseMintNaturalAmountFromDecimal(
          t.amount,
          t.decimals
        )
        const transferIx = Token.createTransferInstruction(
          TOKEN_PROGRAM_ID,
          t.from,
          t.to,
          form.governedAccount.extensions.transferAddress!,
          [],
          new u64(mintAmount.toString())
        )
        additionalSerializedInstructions.push(
          serializeInstructionToBase64(transferIx!)
        )
      }
      serializedInstruction = ''
    }
    const obj: UiInstruction = {
      additionalSerializedInstructions,
      prerequisiteInstructions,
      serializedInstruction: serializedInstruction,
      isValid,
      governance: form.governedAccount?.governance,
      customHoldUpTime: form.distributionNumber,
    }
    return obj
  }
  const handleSelectDistribution = async (number: number) => {
    const distribution = await client?.loadDistribution(number)
    setDistribution(distribution)
  }
  const fetchVaults = async () => {
    if (!client || !distribution) return
    const v: any = {}
    for (let i = 0; i < distribution.metadata!.mints.length; i++) {
      const mint = distribution.metadata!.mints[i]
      const vaultAddress = distribution.findVaultAddress(
        new PublicKey(mint.address)
      )
      try {
        const tokenAccount = await tryGetTokenAccount(
          connection.current,
          vaultAddress
        )

        v[vaultAddress.toString()] = {
          publicKey: vaultAddress,
          amount: tokenAccount?.account.amount,
          mint: tokenAccount?.account.mint,
          mintIndex: i,
        }
      } catch {
        v[vaultAddress.toString()] = { amount: -1, mintIndex: i }
      }
    }
    setVaults(v)
  }
  useEffect(() => {
    if (distribution) {
      fetchVaults()
    }
  }, [distribution])
  useEffect(() => {
    const client = new MangoMintsRedemptionClient(
      new AnchorProvider(
        connection.current,
        new EmptyWallet(Keypair.generate()),
        { skipPreflight: true }
      )
    )
    setClient(client)
  }, [])
  useEffect(() => {
    if (vaults && form.governedAccount) {
      const trans = Object.values(vaults).map((v) => {
        const from = assetAccounts.find(
          (assetAccount) =>
            assetAccount.isToken &&
            assetAccount.extensions.mint?.publicKey.equals(v.mint) &&
            assetAccount.extensions.token?.account.owner.equals(
              form.governedAccount!.extensions.transferAddress!
            )
        )
        if (!from) {
          return undefined
        }
        return {
          from: from!.pubkey,
          to: v.publicKey,
          amount: '',
          decimals: from!.extensions.mint!.account.decimals,
          mintIndex: v.mintIndex,
        }
      })
      setTransfers(trans.filter((x) => x) as Transfer[])
    } else {
      setTransfers([])
    }
  }, [vaults])

  useEffect(() => {
    handleSetInstructions(
      { governedAccount: form.governedAccount?.governance, getInstruction },
      index
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO please fix, it can cause difficult bugs. You might wanna check out https://bobbyhadz.com/blog/react-hooks-exhaustive-deps for info. -@asktree
  }, [form])
  const schema = yup.object().shape({
    governedAccount: yup
      .object()
      .nullable()
      .required('Program governed account is required'),
  })
  const inputs: InstructionInput[] = [
    {
      label: 'Governance',
      initialValue: form.governedAccount,
      name: 'governedAccount',
      type: InstructionInputType.GOVERNED_ACCOUNT,
      shouldBeGoverned: shouldBeGoverned as any,
      governance: governance,
      options: solAccounts,
    },
    {
      label: 'Distribution Number',
      initialValue: form.distributionNumber,
      type: InstructionInputType.INPUT,
      additionalComponent: (
        <div>
          <Button
            onClick={() => handleSelectDistribution(form.distributionNumber)}
          >
            Load
          </Button>
        </div>
      ),
      inputType: 'number',
      name: 'distributionNumber',
    },
  ]

  return (
    <>
      {form && (
        <>
          <InstructionForm
            outerForm={form}
            setForm={setForm}
            inputs={inputs}
            setFormErrors={setFormErrors}
            formErrors={formErrors}
          ></InstructionForm>
          {distribution && vaults && (
            <div className="border-t border-th-bkg-2 px-6 py-3">
              <span className="mr-4 mb-3 flex flex-col whitespace-nowrap text-th-fgd-3">
                Vaults to fill
              </span>
              <span className="flex flex-col font-mono text-th-fgd-2">
                <div>
                  {transfers
                    ? transfers.map((t, idx) => {
                        return (
                          <div
                            key={t.to.toBase58()}
                            className="flex justify-between"
                          >
                            <p>{t.to.toBase58()}</p>{' '}
                            <p>
                              {
                                distribution.metadata!.mints[t.mintIndex]
                                  .properties?.name
                              }
                            </p>{' '}
                            <span>
                              <Input
                                value={t.amount}
                                onChange={(e) => {
                                  const newTrans = transfers.map(
                                    (x, innerIdex) => {
                                      if (innerIdex === idx) {
                                        return {
                                          ...x,
                                          amount: e.target.value,
                                        }
                                      }
                                      return x
                                    }
                                  )
                                  setTransfers(newTrans)
                                }}
                                type="text"
                              ></Input>
                            </span>
                          </div>
                        )
                      })
                    : 'Loading...'}
                </div>
              </span>
            </div>
          )}
        </>
      )}
    </>
  )
}

export default FillVaults
