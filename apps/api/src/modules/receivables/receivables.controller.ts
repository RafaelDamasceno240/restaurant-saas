import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { ReceivablesService } from './receivables.service';
import {
  CancelReceivableDto,
  CreateReceivableDto,
  ListReceivablesQueryDto,
  RegisterReceivablePaymentDto,
  ReverseReceivablePaymentDto,
  SetCreditLimitDto,
} from './dto/receivables.dto';

// tenantId always comes from the JWT (@CurrentUser). SELLING on account is not here: it happens
// inside the order flows (PDV and table checkout, permission receivables.sell), where the
// credit limit is checked against the locked account in the transaction that creates the order.
@ApiTags('receivables')
@ApiBearerAuth()
@Controller('receivables')
export class ReceivablesController {
  constructor(private readonly receivables: ReceivablesService) {}

  @Get()
  @RequirePermissions('receivables.read')
  @ApiOperation({ summary: 'Contas a receber (em aberto, vencidas, quitadas, canceladas), com totais' })
  list(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ListReceivablesQueryDto) {
    return this.receivables.list(user, query);
  }

  @Post()
  @RequirePermissions('receivables.manage')
  @ApiOperation({ summary: 'Lança uma dívida avulsa para um cliente (idempotente pela chave)' })
  create(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: CreateReceivableDto) {
    return this.receivables.create(user, dto);
  }

  // Declared before ':id' so "customers" and "entries" are never taken for a receivable id.
  @Get('customers/:customerId')
  @RequirePermissions('receivables.read')
  @ApiOperation({ summary: 'Limite, dívida em aberto, disponível e vencido do cliente' })
  getAccount(@CurrentUser() user: AuthenticatedRequestUser, @Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.receivables.getAccount(user, customerId);
  }

  @Put('customers/:customerId/limit')
  @RequirePermissions('receivables.manage')
  @ApiOperation({ summary: 'Define o limite de fiado do cliente (0 = sem fiado)' })
  setLimit(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: SetCreditLimitDto,
  ) {
    return this.receivables.setLimit(user, customerId, dto);
  }

  @Post('entries/:entryId/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('receivables.manage')
  @ApiOperation({ summary: 'Estorna um pagamento (uma única vez), com motivo' })
  reversePayment(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body() dto: ReverseReceivablePaymentDto,
  ) {
    return this.receivables.reversePayment(user, entryId, dto);
  }

  @Get(':id')
  @RequirePermissions('receivables.read')
  @ApiOperation({ summary: 'Detalhe da conta: parcelas e histórico de movimentações' })
  findOne(@CurrentUser() user: AuthenticatedRequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.receivables.findOne(user, id);
  }

  @Post(':id/payments')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('receivables.receive')
  @ApiOperation({ summary: 'Registra um pagamento total ou parcial (idempotente pela chave)' })
  registerPayment(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegisterReceivablePaymentDto,
  ) {
    return this.receivables.registerPayment(user, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('receivables.manage')
  @ApiOperation({ summary: 'Cancela uma conta que não recebeu nenhum pagamento, com motivo' })
  cancel(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelReceivableDto,
  ) {
    return this.receivables.cancel(user, id, dto);
  }
}
