import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { OrdersService } from './orders.service';
import { ListOrdersQueryDto, OrdersBoardQueryDto } from './dto/list-orders-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { SetOrderCustomerDto } from './dto/set-order-customer.dto';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Lista pedidos do tenant autenticado (paginado, filtrável por status)' })
  findAll(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ListOrdersQueryDto) {
    return this.ordersService.findAllForUser(user, query);
  }

  // Declared before ':id' so "board" is never taken for an order id.
  @Get('board')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Quadro da cozinha: pedidos em andamento, uma coluna por status, em uma chamada' })
  board(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: OrdersBoardQueryDto) {
    return this.ordersService.boardForUser(user, query);
  }

  @Get(':id')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Detalhe de um pedido — 404 se pertencer a outro tenant' })
  findOne(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    return this.ordersService.findOneForUser(user, id);
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

  @Get(':id/customer-suggestions')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Clientes cadastrados com o telefone digitado no pedido (sugestão; exige customers.read)' })
  customerSuggestions(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    return this.ordersService.customerSuggestions(user, id);
  }

  @Patch(':id/customer')
  @RequirePermissions('orders.update')
  @ApiOperation({ summary: 'Vincula o pedido a um cliente cadastrado, ou desvincula (exige customers.read)' })
  setCustomer(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id') id: string,
    @Body() dto: SetOrderCustomerDto,
  ) {
    return this.ordersService.setCustomer(user, id, dto.customerId);
  }
}
