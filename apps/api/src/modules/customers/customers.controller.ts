import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { CustomersService } from './customers.service';
import {
  CreateCustomerDto,
  ListCustomerOrdersQueryDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from './dto/customers.dto';

// tenantId always comes from the JWT (@CurrentUser); no route, query or body field carries it.
@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'Lista clientes do restaurante, com busca, filtro ativo/inativo e paginação' })
  list(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ListCustomersQueryDto) {
    return this.customers.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'Detalhe do cliente com métricas (pedidos, total gasto, ticket médio, última compra)' })
  findOne(@CurrentUser() user: AuthenticatedRequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.findOne(user, id);
  }

  @Get(':id/orders')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'Histórico de pedidos do cliente (limitado às unidades que o usuário acessa)' })
  orders(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListCustomerOrdersQueryDto,
  ) {
    return this.customers.orders(user, id, query);
  }

  @Post()
  @RequirePermissions('customers.create')
  @ApiOperation({ summary: 'Cadastra um cliente' })
  create(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: CreateCustomerDto) {
    return this.customers.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('customers.update')
  @ApiOperation({ summary: 'Edita, inativa (active=false) ou reativa um cliente' })
  update(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers.update(user, id, dto);
  }
}
