import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { OrdersService } from './orders.service';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Lista pedidos do tenant autenticado (paginado, filtrável por status)' })
  findAll(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ListOrdersQueryDto) {
    return this.ordersService.findAllForTenant(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Detalhe de um pedido — 404 se pertencer a outro tenant' })
  findOne(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    return this.ordersService.findOneForTenant(user.tenantId, id);
  }

  @Patch(':id/status')
  @RequirePermissions('orders.update')
  @ApiOperation({ summary: 'Muda o status do pedido, respeitando as transições válidas' })
  updateStatus(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(user.tenantId, id, dto.status, user);
  }
}
