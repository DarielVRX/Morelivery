import { useCallback, useMemo, useState } from 'react';

import { useDriverOrders } from '../../../hooks/useDriverOrders';

export function useDriverOrdersPageState(token) {
  const orderState = useDriverOrders(token);
  const [tab, setTab] = useState('active');
  const [reportingId, setReportingId] = useState(null);
  const [reportText, setReportText] = useState('');
  const [reportMsg, setReportMsg] = useState('');
  const [releaseNote, setReleaseNote] = useState('');
  const [releasingId, setReleasingId] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [chatOpen, setChatOpen] = useState(null);

  const waitingTabLabel = useMemo(
    () => (orderState.unoffered.length > 0 ? `En espera (${orderState.unoffered.length})` : 'En espera'),
    [orderState.unoffered.length]
  );

  const toggleChat = useCallback((value) => {
    setChatOpen((current) => {
      const nextValue = current === value ? null : value;
      orderState.setChatOpen(nextValue);
      return nextValue;
    });
  }, [orderState]);

  const closeReleaseEditor = useCallback(() => {
    setReleasingId(null);
    setReleaseNote('');
  }, []);

  const confirmRelease = useCallback(
    (orderId) => orderState.releaseOrder(orderId, releaseNote, closeReleaseEditor),
    [closeReleaseEditor, orderState, releaseNote]
  );

  const sendReport = useCallback(async (orderId) => {
    if (!reportText.trim()) return;
    await orderState.sendReport(orderId, reportText, () => {
      setReportingId(null);
      setReportText('');
      setReportMsg('Reporte enviado');
      setTimeout(() => setReportMsg(''), 3000);
    });
  }, [orderState, reportText]);

  return {
    ...orderState,
    tab,
    setTab,
    waitingTabLabel,
    reportingId,
    setReportingId,
    reportText,
    setReportText,
    reportMsg,
    releaseNote,
    setReleaseNote,
    releasingId,
    setReleasingId,
    expanded,
    setExpanded,
    chatOpen,
    toggleChat,
    sendReport,
    closeReleaseEditor,
    confirmRelease,
  };
}
