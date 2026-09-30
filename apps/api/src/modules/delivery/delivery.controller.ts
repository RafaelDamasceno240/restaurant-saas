import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { DeliveryService } from './delivery.service';
import {
  DeliverySettingsQueryDto,
  FailDeliveryDto,
  ListDeliveriesQueryDto,
  UpdateDeliveryNotesDto,
  UpdateDeliverySettingsDto,
} from './dto/delivery.dto';

@ApiTags('delivery')
@ApiBearerAuth()
@Controller('delivery')
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get()
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'Lista as entregas da unidade, com contagem por status' })
  list(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ListDeliveriesQueryDto) {
    return this.delivery.list(user, query);
  }

  // Declared before the ':id' routes so "settings" is never captured as an id.
  @Get('settings')
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'Configurações de entrega da unidade (habilitada, taxa, pedido mínimo)' })
  getSettings(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: DeliverySettingsQueryDto) {
    return this.delivery.getSettings(user, query);
  }

  @Put('settings')
  @RequirePermissions('delivery.configure')
  @ApiOperation({ summary: 'Atualiza as configurações de entrega da unidade' })
  updateSettings(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: UpdateDeliverySettingsDto) {
    return this.delivery.updateSettings(user, dto);
  }

  @Post(':id/dispatch')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('delivery.update')
  @ApiOperation({ summary: 'Despacha a entrega (pedido pronto -> saiu para entrega); idempotente' })
  dispatch(@CurrentUser() user: AuthenticatedRequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.delivery.dispatch(user, id);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('delivery.update')
  @ApiOperation({ summary: 'Confirma a entrega (saiu para entrega -> entregue); idempotente' })
  complete(@CurrentUser() user: AuthenticatedRequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.delivery.complete(user, id);
  }

  @Post(':id/fail')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('delivery.update')
  @ApiOperation({ summary: 'Registra a falha da entrega em rota; o pedido volta a "pronto" (não é cancelado); idempotente' })
  fail(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FailDeliveryDto,
  ) {
    return this.delivery.fail(user, id, dto.reason);
  }

  @Post(':id/redeliver')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('delivery.update')
  @ApiOperation({ summary: 'Solicita nova tentativa para uma entrega que falhou (falhou -> pendente); idempotente' })
  redeliver(@CurrentUser() user: AuthenticatedRequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.delivery.redeliver(user, id);
  }

  @Patch(':id/notes')
  @RequirePermissions('delivery.update')
  @ApiOperation({ summary: 'Define ou limpa a observação da entrega (separada da observação do pedido)' })
  updateNotes(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeliveryNotesDto,
  ) {
    return this.delivery.updateNotes(user, id, dto);
  }
}
