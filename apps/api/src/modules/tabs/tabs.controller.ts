import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { TabsService } from './tabs.service';
import { CreateTabDto } from './dto/create-tab.dto';
import { AddTabItemDto } from './dto/add-tab-item.dto';
import { UpdateTabItemDto } from './dto/update-tab-item.dto';
import { ListTabsQueryDto } from './dto/list-tabs-query.dto';
import { CheckoutTabDto } from './dto/checkout-tab.dto';

// Item mutations (add/update/remove) are gated by tabs.update — the spec
// only lists tabs.read/create/update/close, no separate item-level permission.
@ApiTags('tabs')
@ApiBearerAuth()
@Controller('tabs')
export class TabsController {
  constructor(private readonly tabsService: TabsService) {}

  @Get()
  @RequirePermissions('tabs.read')
  @ApiOperation({ summary: 'Lista comandas de uma unidade (abertas por padrão)' })
  findAll(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ListTabsQueryDto) {
    return this.tabsService.findAllForBranch(user, query);
  }

  @Get(':id')
  @RequirePermissions('tabs.read')
  @ApiOperation({ summary: 'Detalhe de uma comanda: mesa, itens e total' })
  findOne(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    return this.tabsService.findOneForTenant(user, id);
  }

  @Post()
  @RequirePermissions('tabs.create')
  @ApiOperation({ summary: 'Abre uma comanda para uma mesa (409 se a mesa já estiver ocupada)' })
  open(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: CreateTabDto) {
    return this.tabsService.open(user, dto);
  }

  @Post(':id/items')
  @RequirePermissions('tabs.update')
  @ApiOperation({ summary: 'Adiciona um item; preço/nome sempre recalculados no backend' })
  addItem(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id') id: string,
    @Body() dto: AddTabItemDto,
  ) {
    return this.tabsService.addItem(user, id, dto);
  }

  @Patch(':id/items/:itemId')
  @RequirePermissions('tabs.update')
  @ApiOperation({ summary: 'Altera quantidade/observação de um item' })
  updateItem(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateTabItemDto,
  ) {
    return this.tabsService.updateItem(user, id, itemId, dto);
  }

  @Delete(':id/items/:itemId')
  @RequirePermissions('tabs.update')
  @ApiOperation({ summary: 'Remove um item da comanda' })
  removeItem(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.tabsService.removeItem(user, id, itemId);
  }

  // Fatia 10: replaces the old operational POST /:id/close — closing a tab now
  // always means selling it. 200 for both the first call and an idempotent
  // replay (same key); `idempotentReplay` in the body tells them apart.
  @Post(':id/checkout')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('tabs.close')
  @ApiOperation({ summary: 'Fecha a comanda como venda paga (atômico e idempotente por idempotencyKey)' })
  checkout(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id') id: string,
    @Body() dto: CheckoutTabDto,
  ) {
    return this.tabsService.checkout(user, id, dto);
  }
}
