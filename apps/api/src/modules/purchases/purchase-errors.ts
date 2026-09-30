import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export function purchaseNotFound() {
  return new NotFoundException({ code: 'PURCHASE_NOT_FOUND', message: 'Compra não encontrada.' });
}

export function supplierNotFound() {
  return new NotFoundException({ code: 'SUPPLIER_NOT_FOUND', message: 'Fornecedor não encontrado.' });
}

export function supplierInactive() {
  return new ConflictException({ code: 'SUPPLIER_INACTIVE', message: 'Este fornecedor está inativo.' });
}

export function supplierAlreadyExists() {
  return new ConflictException({
    code: 'SUPPLIER_ALREADY_EXISTS',
    message: 'Já existe um fornecedor ativo com este nome.',
  });
}

export function purchaseNotEditable() {
  return new ConflictException({
    code: 'PURCHASE_NOT_EDITABLE',
    message: 'Somente compras em rascunho podem ser editadas.',
  });
}

export function purchaseCancelled() {
  return new ConflictException({ code: 'PURCHASE_CANCELLED', message: 'Esta compra foi cancelada.' });
}

export function purchaseEmpty() {
  return new BadRequestException({ code: 'PURCHASE_EMPTY', message: 'A compra precisa ter ao menos um item.' });
}

export function invalidPurchaseTotal() {
  return new BadRequestException({
    code: 'INVALID_PURCHASE_TOTAL',
    message: 'O desconto não pode ser maior que a soma dos itens, frete e outros custos.',
  });
}

export function purchaseAmountTooLarge(field: 'line' | 'subtotal' | 'total') {
  return new BadRequestException({
    code: 'PURCHASE_AMOUNT_TOO_LARGE',
    message: 'O valor da compra excede o limite permitido de R$ 21.474.836,47. Reduza quantidades, custos ou ajustes.',
    details: { field },
  });
}

export function cancelReasonRequired() {
  return new BadRequestException({
    code: 'CANCEL_REASON_REQUIRED',
    message: 'Informe o motivo para cancelar uma compra já recebida.',
  });
}

export function purchaseAlreadyProcessed() {
  return new ConflictException({
    code: 'PURCHASE_ALREADY_PROCESSED',
    message: 'Esta compra já foi processada por outra requisição.',
  });
}

export function purchaseStockMismatch() {
  return new ConflictException({
    code: 'PURCHASE_STOCK_MISMATCH',
    message: 'As entradas de estoque desta compra não foram encontradas para estorno.',
  });
}
