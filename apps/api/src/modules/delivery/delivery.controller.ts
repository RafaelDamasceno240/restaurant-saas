import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { DeliveryService } from './delivery.service';
import {
  AssignCourierDto,
  CouriersQueryDto,
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

  // Static route, declared before the ':id' ones.
  @Get('couriers')
  @RequirePermissions('delivery.assign')
  @ApiOperation({ summary: 'Entregadores elegíveis para a unidade (ativos, papel DELIVERY, com acesso à unidade)' })
  couriers(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: CouriersQueryDto) {
    return this.delivery.listCouriers(user, query);
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

  @Get(':id/history')
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'Histórico operacional da entrega (tentativas, falhas, atribuições), reconstruído da auditoria' })
  history(@CurrentUser() user: AuthenticatedRequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.delivery.history(user, id);
  }

  @Put(':id/courier')
  @RequirePermissions('delivery.assign')
  @ApiOperation({ summary: 'Atribui ou reatribui o entregador da entrega; idempotente' })
  assignCourier(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignCourierDto,
  ) {
    return this.delivery.assignCourier(user, id, dto.courierUserId);
  }

  @Delete(':id/courier')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('delivery.assign')
  @ApiOperation({ summary: 'Remove o entregador da entrega; idempotente' })
  unassignCourier(@CurrentUser() user: AuthenticatedRequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.delivery.unassignCourier(user, id);
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
