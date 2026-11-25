export function summarizeCut(orders, cutId) {
  const cutOrders = orders.filter((order) => order.cutId === cutId)
  let costCents = 0
  let missingCostLines = 0
  let salesCents = 0

  for (const order of cutOrders) {
    salesCents += order.totalCents
    for (const item of order.products) {
      if (!Number.isSafeInteger(item.costCents) || item.costCents < 0) {
        missingCostLines++
        continue
      }
      costCents += item.costCents * item.quantity
    }
  }

  return {
    orderCount: cutOrders.length,
    salesCents,
    costCents: missingCostLines ? null : costCents,
    profitCents: missingCostLines ? null : salesCents - costCents,
    missingCostLines,
  }
}