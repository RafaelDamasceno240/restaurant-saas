import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { CashbackService } from './cashback.service';
import {
  AdjustCashbackDto,
  ListCashbackEntriesQueryDto,
  ReverseCashbackEntryDto,
  UpdateCashbackProgramDto,
} from './dto/cashback.dto';

// tenantId always comes from the JWT (@CurrentUser). SPENDING cashback is not here: it happens
// inside the order flows (PDV and table checkout, permission cashback.use), where the amount is
// validated against the locked balance in the transaction that creates the order.
@ApiTags('cashback')
@ApiBearerAuth()
@Controller('cashback')
export class CashbackController {
  constructor(private readonly cashback: CashbackService) {}

  @Get('program')
  @RequirePermissions('cashback.read')
  @ApiOperation({ summary: 'Configuração do cashback do restaurante' })
  getProgram(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.cashback.getProgram(user);
  }

  @Put('program')
  @RequirePermissions('cashback.configure')
  @ApiOperation({ summary: 'Liga/desliga o cashback, define o percentual e a expiração' })
  updateProgram(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: UpdateCashbackProgramDto) {
    return this.cashback.updateProgram(user, dto);
  }

  @Post('expire')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('cashback.configure')
  @ApiOperation({ summary: 'Baixa no ledger os saldos já expirados que ninguém movimentou' })
  expire(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.cashback.expireIdleBalances(user);
  }

  @Get('customers/:customerId')
  @RequirePermissions('cashback.read')
  @ApiOperation({ summary: 'Saldo de cashback disponível do cliente e quando expira' })
  getAccount(@CurrentUser() user: AuthenticatedRequestUser, @Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.cashback.getAccount(user, customerId);
  }

  @Get('customers/:customerId/entries')
  @RequirePermissions('cashback.read')
  @ApiOperation({ summary: 'Extrato de cashback do cliente (mais recente primeiro)' })
  listEntries(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query() query: ListCashbackEntriesQueryDto,
  ) {
    return this.cashback.listEntries(user, customerId, query);
  }

  @Post('customers/:customerId/adjust')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('cashback.adjust')
  @ApiOperation({ summary: 'Ajuste administrativo de cashback, com motivo (idempotente pela chave)' })
  adjust(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: AdjustCashbackDto,
  ) {
    return this.cashback.adjust(user, customerId, dto);
  }

  @Post('entries/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('cashback.adjust')
  @ApiOperation({ summary: 'Estorna um crédito de compra ou um ajuste (uma única vez), com motivo' })
  reverse(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseCashbackEntryDto,
  ) {
    return this.cashback.reverse(user, id, dto);
  }
}
