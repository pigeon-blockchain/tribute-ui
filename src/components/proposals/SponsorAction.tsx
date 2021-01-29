import {useSelector} from 'react-redux';

import {
  prepareVoteProposalData,
  SnapshotType,
} from '@openlaw/snapshot-js-erc712';
import {getContractByAddress} from '../web3/helpers';
import {ProposalData} from './types';
import {StoreState} from '../../store/types';
import {useContractSend, useETHGasPrice, useWeb3Modal} from '../web3/hooks';
import {useMemberActionDisabled} from '../../hooks';
import {useSignAndSubmitProposal} from './hooks';
import React, {useState} from 'react';
import {Web3TxStatus} from '../web3/types';
import FadeIn from '../common/FadeIn';
import CycleMessage from '../feedback/CycleMessage';
import {TX_CYCLE_MESSAGES} from '../web3/config';
import EtherscanURL from '../web3/EtherscanURL';
import ErrorMessageWithDetails from '../common/ErrorMessageWithDetails';
import Loader from '../feedback/Loader';

type SponsorArguments = [
  string, // `dao`
  string, // `proposalId`
  string // `proposal data`
];

type SponsorActionProps = {
  proposal: ProposalData;
};

export default function SponsorAction(props: SponsorActionProps) {
  const {
    proposal: {snapshotDraft},
  } = props;

  /**
   * State
   */

  const [submitError, setSubmitError] = useState<Error>();

  /**
   * Selectors
   */

  const contracts = useSelector((s: StoreState) => s.contracts);
  const daoRegistryAddress = useSelector(
    (s: StoreState) => s.contracts.DaoRegistryContract?.contractAddress
  );

  /**
   * Our hooks
   */

  const {account, web3Instance} = useWeb3Modal();

  const {txEtherscanURL, txIsPromptOpen, txSend, txStatus} = useContractSend();

  const {
    isDisabled,
    openWhyDisabledModal,
    WhyDisabledModal,
  } = useMemberActionDisabled();

  const {
    proposalSignAndSendStatus,
    signAndSendProposal,
  } = useSignAndSubmitProposal<SnapshotType.proposal>();

  const gasPrices = useETHGasPrice();

  /**
   * Variables
   */

  const isInProcess =
    txStatus === Web3TxStatus.AWAITING_CONFIRM ||
    txStatus === Web3TxStatus.PENDING ||
    proposalSignAndSendStatus === Web3TxStatus.AWAITING_CONFIRM ||
    proposalSignAndSendStatus === Web3TxStatus.PENDING;

  const isDone =
    txStatus === Web3TxStatus.FULFILLED &&
    proposalSignAndSendStatus === Web3TxStatus.FULFILLED;

  const isInProcessOrDone = isInProcess || isDone || txIsPromptOpen;

  /**
   * Functions
   */

  async function handleSubmit() {
    try {
      if (!daoRegistryAddress) {
        throw new Error('No DAO Registry address was found.');
      }

      if (!snapshotDraft) {
        throw new Error('No Snapshot draft was found.');
      }

      const contract = getContractByAddress(snapshotDraft.actionId, contracts);

      const {
        msg: {
          payload: {name, body, metadata},
          timestamp,
        },
      } = snapshotDraft;

      // Sign and submit draft for snapshot-hub
      const {data, signature} = await signAndSendProposal({
        partialProposalData: {
          name,
          body,
          metadata,
          timestamp,
        },
        adapterAddress: contract.contractAddress,
        type: SnapshotType.proposal,
      });

      // Prepare data for submission to DAO
      const dataToPrepare = {
        payload: {
          name: data.payload.name,
          body: data.payload.body,
          choices: data.payload.choices,
          snapshot: data.payload.snapshot.toString(),
          start: data.payload.start,
          end: data.payload.end,
        },
        sig: signature,
        space: data.space,
        timestamp: parseInt(data.timestamp),
      };

      const sponsorArguments: SponsorArguments = [
        daoRegistryAddress,
        snapshotDraft.idInDAO,
        prepareVoteProposalData(dataToPrepare, web3Instance),
      ];

      const txArguments = {
        from: account || '',
        // Set a fast gas price
        ...(gasPrices ? {gasPrice: gasPrices.fast} : null),
      };

      await txSend(
        'sponsorProposal',
        contract.instance.methods,
        sponsorArguments,
        txArguments
      );
    } catch (error) {
      setSubmitError(error);
    }
  }

  /**
   * Render
   */

  function renderSubmitStatus(): React.ReactNode {
    // Either Snapshot or chain tx
    if (
      txStatus === Web3TxStatus.AWAITING_CONFIRM ||
      proposalSignAndSendStatus === Web3TxStatus.AWAITING_CONFIRM
    ) {
      return 'Awaiting your confirmation\u2026';
    }

    // Only for chain tx
    switch (txStatus) {
      case Web3TxStatus.PENDING:
        return (
          <>
            <CycleMessage
              intervalMs={2000}
              messages={TX_CYCLE_MESSAGES}
              useFirstItemStart
              render={(message) => {
                return <FadeIn key={message}>{message}</FadeIn>;
              }}
            />

            <EtherscanURL url={txEtherscanURL} isPending />
          </>
        );
      case Web3TxStatus.FULFILLED:
        return (
          <>
            <div>Proposal submitted!</div>

            <EtherscanURL url={txEtherscanURL} />
          </>
        );
      default:
        return null;
    }
  }

  return (
    <>
      <div>
        <button
          className="proposaldetails__button"
          disabled={isDisabled || isInProcessOrDone}
          onClick={isDisabled || isInProcessOrDone ? () => {} : handleSubmit}>
          {isInProcess ? <Loader /> : isDone ? 'Done' : 'Sponsor'}
        </button>

        <ErrorMessageWithDetails
          error={submitError}
          renderText="Something went wrong"
        />

        {/* SUBMIT STATUS */}
        <div className="form__submit-status-container">
          {isInProcessOrDone && renderSubmitStatus()}
        </div>

        {isDisabled && (
          <button className="button--help" onClick={openWhyDisabledModal}>
            Why is sponsoring disabled?
          </button>
        )}
      </div>

      <WhyDisabledModal title="Why is sponsoring disabled?" />
    </>
  );
}
