import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { PurchasesService } from './purchases.service';
import { SuppliersService } from './suppliers.service';
import { CancelPurchaseDto, CreatePurchaseDto, ListPurchasesQueryDto, UpdatePurchaseDto } from './dto/purchases.dto';
import { CreateSupplierDto, ListSuppliersQueryDto, UpdateSupplierDto } from './dto/suppliers.dto';

@ApiTags('purchases')
@ApiBearerAuth()
@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  @RequirePermissions('purchases.read')
  @ApiOperation({ summary: 'Lista compras da unidade com totais por status' })
  list(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ListPurchasesQueryDto) {
    return this.purchases.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('purchases.read')
  @ApiOperation({ summary: 'Detalhe da compra com itens e histórico' })
  findOne(@CurrentUser() user: AuthenticatedRequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.findOne(user, id);
  }

  @Post()
  @RequirePermissions('purchases.create')
  @ApiOperation({ summary: 'Cria uma compra em rascunho (ou já recebida com receiveNow)' })
  create(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: CreatePurchaseDto) {
    return this.purchases.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('purchases.update')
  @ApiOperation({ summary: 'Edita uma compra em rascunho' })
  update(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseDto,
  ) {
    return this.purchases.update(user, id, dto);
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('purchases.receive')
  @ApiOperation({ summary: 'Recebe a compra e gera a entrada de estoque (idempotente)' })
  receive(@CurrentUser() user: AuthenticatedRequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.receive(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('purchases.cancel')
  @ApiOperation({ summary: 'Cancela a compra; se já recebida, estorna a entrada de estoque' })
  cancel(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelPurchaseDto,
  ) {
    return this.purchases.cancel(user, id, dto);
  }
}

@ApiTags('suppliers')
@ApiBearerAuth()
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermissions('suppliers.read')
  @ApiOperation({ summary: 'Lista fornecedores do restaurante' })
  list(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ListSuppliersQueryDto) {
    return this.suppliers.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('suppliers.read')
  @ApiOperation({ summary: 'Detalhe do fornecedor' })
  findOne(@CurrentUser() user: AuthenticatedRequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.suppliers.findOne(user, id);
  }

  @Post()
  @RequirePermissions('suppliers.create')
  @ApiOperation({ summary: 'Cadastra um fornecedor' })
  create(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: CreateSupplierDto) {
    return this.suppliers.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('suppliers.update')
  @ApiOperation({ summary: 'Edita, ativa ou desativa um fornecedor' })
  update(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliers.update(user, id, dto);
  }
}
